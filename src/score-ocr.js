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
        if (msg.type === 'error' && msg.id == null) { clearTimeout(timeout); reject(new Error(msg.msg)); return; }
        const task = pending.get(msg.id);
        if (!task) return;
        if (msg.type === 'result') { pending.delete(msg.id); task.resolve(msg); }
        else if (msg.type === 'error') { pending.delete(msg.id); task.reject(new Error(msg.msg)); }
      });
      worker.addEventListener('error', event => {
        clearTimeout(timeout);
        reject(new Error(event.message || 'The local recognition worker failed to start.'));
      }, { once: true });
      worker.postMessage({ type: 'init' });
    });
  }
  return workerReady.then(() => worker);
}

function canvasForImage(image) {
  const sourceWidth = Number(image.naturalWidth || image.width) || 0;
  const sourceHeight = Number(image.naturalHeight || image.height) || 0;
  if (sourceWidth < 1 || sourceHeight < 1) throw new Error('This image has no readable dimensions. Export it as a PNG or JPEG and try again.');
  // Keep inputs within the recogniser's supported image size and avoid zero-sized
  // OpenCV resize targets for malformed or unusually large source images.
  const scale = Math.min(1, 2480 / sourceWidth, 4200 / sourceHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Your browser could not prepare the score image.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try { const image = new Image(); image.src = url; await image.decode(); return canvasForImage(image); }
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
      const scale = Math.min(1.5, 2480 / Math.max(1, base.width), 4200 / Math.max(1, base.height));
      const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      page.cleanup(); canvases.push(canvas);
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
