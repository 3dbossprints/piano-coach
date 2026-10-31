import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export function getScoreFileKind(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'image/svg+xml' || name.endsWith('.svg')) return 'svg';
  if (['image/png','image/jpeg','image/webp'].includes(type) || /\.(png|jpe?g|webp)$/i.test(name)) return 'image';
  return null;
}

const MODEL_BYTES = 157482318;
let worker;
let workerReady;
let requestId = 0;
const pending = new Map();

function getWorker(onProgress) {
  if (!worker) {
    worker = new Worker('/omr-worker.js', { type: 'module' });
    workerReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The local OMR engine took too long to initialise.')), 8 * 60 * 1000);
      worker.addEventListener('message', event => {
        const msg = event.data || {};
        if (msg.type === 'ready') { clearTimeout(timeout); resolve(msg); return; }
        if (msg.type === 'progress') {
          if (msg.stage === 'download') onProgress?.('Downloading on-device music recognition models (' + Math.round(100 * (msg.loaded || 0) / MODEL_BYTES) + '%)…');
          else if (msg.stage === 'python') onProgress?.('Starting local music recognition runtime…');
          else if (msg.stage === 'retry') onProgress?.('Retrying a model download (attempt ' + msg.attempt + ')…');
          return;
        }
        if (msg.type === 'log') { onProgress?.(msg.msg); return; }
        if (msg.type === 'error' && msg.id == null) {
          clearTimeout(timeout);
          const error = new Error(msg.msg || 'The local recognition worker failed.');
          for (const task of pending.values()) task.reject(error);
          pending.clear();
          const failedWorker = worker;
          worker = null;
          workerReady = null;
          failedWorker?.terminate();
          reject(error);
          return;
        }
        const task = pending.get(msg.id);
        if (!task) return;
        if (msg.type === 'result') { pending.delete(msg.id); task.resolve(msg); }
        else if (msg.type === 'error') { pending.delete(msg.id); task.reject(new Error(msg.msg)); }
      });
      worker.addEventListener('error', event => {
        clearTimeout(timeout);
        const error = new Error(event.message || 'The local recognition worker failed to start.');
        for (const task of pending.values()) task.reject(error);
        pending.clear();
        const failedWorker = worker;
        worker = null;
        workerReady = null;
        failedWorker?.terminate();
        reject(error);
      }, { once: true });
      worker.postMessage({ type: 'init' });
    });
  }
  return workerReady.catch(error => {
    // A rejected initialisation promise must not poison every retry in this tab.
    const failedWorker = worker;
    failedWorker?.terminate();
    if (worker === failedWorker) {
      worker = null;
      workerReady = null;
    }
    throw error;
  }).then(() => worker);
}

function canvasForImage(image) {
  const sourceWidth = Number(image.naturalWidth || image.width) || 0;
  const sourceHeight = Number(image.naturalHeight || image.height) || 0;
  if (sourceWidth < 1 || sourceHeight < 1) throw new Error('This image has no readable dimensions. Export it as a PNG or JPEG and try again.');
  // Normalise oversized inputs and add a white border. HOMR's staff-cropping
  // stage can produce empty crops when the score touches the image edge; a
  // modest margin gives it room to find the page and avoids pathological resize
  // targets for tightly cropped scans.
  // Keep more staff-line and notehead detail for HOMR than the previous
  // 2380px cap, while bounding memory use on browser-only recognition.
  const scale = Math.min(1, 2700 / sourceWidth, 4600 / sourceHeight);
  const contentWidth = Math.max(1, Math.round(sourceWidth * scale));
  const contentHeight = Math.max(1, Math.round(sourceHeight * scale));
  const margin = Math.max(24, Math.round(Math.min(contentWidth, contentHeight) * 0.025));
  const canvas = document.createElement('canvas');
  canvas.width = contentWidth + margin * 2;
  canvas.height = contentHeight + margin * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser could not prepare the score image.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, margin, margin, contentWidth, contentHeight);
  if (canvas.width < 1 || canvas.height < 1) throw new Error('The score image could not be prepared. Export a fresh PNG or JPEG and try again.');
  return canvas;
}
// Conservative, low-cost contrast correction for faded scans. Sample a tiny
// thumbnail first so normal high-contrast scores remain byte-for-byte visually
// untouched; only low-contrast pages get a mild browser-native contrast boost.
// This keeps staff lines and noteheads anti-aliased instead of hard-thresholding
// the page, which can erase thin notation.
function improveLowContrast(canvas) {
  if (!canvas || canvas.width < 2 || canvas.height < 2) return canvas;
  const sample = document.createElement('canvas');
  sample.width = 128;
  sample.height = Math.max(32, Math.min(128, Math.round(128 * canvas.height / canvas.width)));
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  if (!sampleCtx) return canvas;
  sampleCtx.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    const y = Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
    histogram[y]++;
    count++;
  }
  if (!count) return canvas;
  const percentile = target => {
    let total = 0;
    for (let value = 0; value < 256; value++) {
      total += histogram[value];
      if (total >= target * count) return value;
    }
    return 255;
  };
  const low = percentile(0.03);
  const high = percentile(0.97);
  sample.width = 1;
  sample.height = 1;
  // Most clean scores span nearly the whole luminance range. Only intervene
  // when the ink/background contrast is unusually compressed.
  if (high - low >= 170 || high <= low) return canvas;
  const enhanced = document.createElement('canvas');
  enhanced.width = canvas.width;
  enhanced.height = canvas.height;
  const ctx = enhanced.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, enhanced.width, enhanced.height);
  ctx.filter = 'contrast(1.22) brightness(1.02)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';
  return enhanced;
}
// Estimate small page skew from a thumbnail's horizontal staff-line projection.
// The scan is rotated only when a clear best angle is found; straight scores are untouched.
function deskewScoreCanvas(canvas) {
  if (!canvas || canvas.width < 240 || canvas.height < 240) return canvas;
  const scale = Math.min(1, 260 / canvas.width, 380 / canvas.height);
  const width = Math.max(80, Math.round(canvas.width * scale));
  const height = Math.max(80, Math.round(canvas.height * scale));
  const sample = document.createElement('canvas');
  sample.width = width; sample.height = height;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  const radians = degrees => degrees * Math.PI / 180;
  let bestAngle = 0, bestScore = -Infinity;
  for (let angle = -3; angle <= 3.001; angle += 0.25) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2, height / 2);
    ctx.rotate(radians(angle));
    ctx.drawImage(canvas, -width / (2 * scale), -height / (2 * scale), width / scale, height / scale);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const rows = new Uint32Array(height);
    for (let y = 2; y < height - 2; y++) {
      let ink = 0;
      for (let x = 2; x < width - 2; x += 2) {
        const i = (y * width + x) * 4;
        const luminance = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        if (luminance < 175) ink++;
      }
      rows[y] = ink;
    }
    let score = 0;
    for (const count of rows) score += count * count;
    if (score > bestScore) { bestScore = score; bestAngle = angle; }
  }
  if (Math.abs(bestAngle) < 0.35) return canvas;
  const radiansAngle = radians(bestAngle);
  const outWidth = Math.ceil(Math.abs(canvas.width * Math.cos(radiansAngle)) + Math.abs(canvas.height * Math.sin(radiansAngle)));
  const outHeight = Math.ceil(Math.abs(canvas.height * Math.cos(radiansAngle)) + Math.abs(canvas.width * Math.sin(radiansAngle)));
  const corrected = document.createElement('canvas');
  corrected.width = outWidth; corrected.height = outHeight;
  const output = corrected.getContext('2d');
  if (!output) return canvas;
  output.fillStyle = '#fff'; output.fillRect(0, 0, outWidth, outHeight);
  output.translate(outWidth / 2, outHeight / 2);
  output.rotate(radiansAngle);
  output.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return corrected;
}
async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try { const image = new Image(); image.src = url; await image.decode(); return improveLowContrast(deskewScoreCanvas(canvasForImage(image))); }
  finally { URL.revokeObjectURL(url); }
}
async function pdfCanvases(file, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const canvases = [];
  try {
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      onProgress?.('Preparing PDF page ' + pageNo + ' of ' + pdf.numPages + '…');
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      // Render vector PDFs at a higher resolution so thin staff lines, dots and
      // ledger lines survive rasterisation before the OMR model sees them.
      const scale = Math.min(2, 3000 / Math.max(1, base.width), 5000 / Math.max(1, base.height));
      const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      page.cleanup(); canvases.push(improveLowContrast(deskewScoreCanvas(canvas)));
    }
  } finally { await pdf.destroy(); }
  return canvases;
}
async function canvasBlob(canvas) {
  if (!canvas || canvas.width < 1 || canvas.height < 1) throw new Error('The score page could not be prepared as an image. Try exporting a fresh PNG or PDF.');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the page image.')), 'image/png'));
}
function combineMusicXml(pages) {
  if (!pages.length) throw new Error('The OMR engine returned no pages.');
  const parser = new DOMParser(), serializer = new XMLSerializer();
  const first = parser.parseFromString(pages[0], 'application/xml');
  if (first.querySelector('parsererror')) throw new Error('The OMR engine returned invalid MusicXML for page 1.');
  const root = first.querySelector('score-partwise');
  if (!root) throw new Error('The OMR engine did not return a score-partwise MusicXML document.');
  const parts = new Map([...root.querySelectorAll(':scope > part')].map(p => [p.getAttribute('id'), p]));
  for (let i = 1; i < pages.length; i++) {
    const doc = parser.parseFromString(pages[i], 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('The OMR engine returned invalid MusicXML for page ' + (i + 1) + '.');
    const incoming = [...doc.querySelectorAll('score-partwise > part')];
    if (!incoming.length) throw new Error('No musical parts were detected on page ' + (i + 1) + '.');
    incoming.forEach((part, partIndex) => {
      const target = parts.get(part.getAttribute('id')) || [...parts.values()][partIndex];
      if (!target) return;
      for (const measure of [...part.querySelectorAll(':scope > measure')]) target.appendChild(first.importNode(measure, true));
    });
  }
  return serializer.serializeToString(first);
}
export async function recognizeScoreFile(file, onProgress = () => {}) {
  const kind = getScoreFileKind(file);
  if (!kind) throw new Error('Choose a PDF, PNG, JPEG, WebP or SVG score.');
  let canvases;
  if (kind === 'pdf') canvases = await pdfCanvases(file, onProgress);
  else canvases = [await imageCanvas(file)];
  if (!canvases.length) throw new Error('No pages were found in this file.');
  const engine = await getWorker(onProgress);
  const xmlPages = [];
  for (let i = 0; i < canvases.length; i++) {
    onProgress('Recognising music on page ' + (i + 1) + ' of ' + canvases.length + '…');
    const blob = await canvasBlob(canvases[i]);
    const buffer = await blob.arrayBuffer();
    const id = ++requestId;
    const xml = await new Promise((resolve, reject) => {
      pending.set(id, { resolve: result => resolve(result.xml), reject });
      engine.postMessage({ type: 'recognise', id, image: buffer }, [buffer]);
    });
    xmlPages.push(xml);
    canvases[i].width = 1; canvases[i].height = 1;
  }
  const musicXML = combineMusicXml(xmlPages);
  const parsed = new DOMParser().parseFromString(musicXML, 'application/xml');
  if (parsed.querySelector('parsererror') || !parsed.querySelector('score-partwise part measure note')) {
    throw new Error('The OMR model did not recognise any notes in this score. Try a clearer, straight scan with visible notation.');
  }
  return { musicXML, pages: canvases.length, engine: 'HOMR on-device OMR' };
}
