import * as pdfjsLib from 'pdfjs-dist';

// Browser-only score image preparation. This deliberately reports uncertainty instead
// of pretending that staff geometry alone can recover a complete engraved score.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

function canvasForImage(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return canvasForImage(image);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfCanvases(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const canvases = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, 1800 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport }).promise;
    canvases.push(canvas);
    onProgress?.(pageNo, pdf.numPages);
  }
  return canvases;
}

function findStaffLines(canvas) {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, width, height);
  const darkness = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = Math.floor(width * .06); x < Math.floor(width * .94); x++) {
      const p = (y * width + x) * 4;
      if ((data[p] + data[p + 1] + data[p + 2]) / 3 < 100) count++;
    }
    darkness[y] = count;
  }
  const threshold = Math.max(20, width * .28);
  const rows = [];
  for (let y = 0; y < height; y++) {
    if (darkness[y] >= threshold && (!rows.length || y - rows[rows.length - 1] > 1)) rows.push(y);
    else if (darkness[y] >= threshold && rows.length) rows[rows.length - 1] = Math.round((rows[rows.length - 1] + y) / 2);
  }
  // Cluster five nearly equally spaced horizontal lines into each staff.
  const staffs = [];
  for (let i = 0; i <= rows.length - 5; i++) {
    const group = rows.slice(i, i + 5);
    const gaps = group.slice(1).map((y, j) => y - group[j]);
    const spacing = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (spacing < 4 || spacing > height * .035) continue;
    if (gaps.some(g => Math.abs(g - spacing) > spacing * .24)) continue;
    if (staffs.length && group[0] - staffs[staffs.length - 1][4] < spacing * 5.5) continue;
    staffs.push(group);
    i += 3;
  }
  return staffs;
}

function detectNoteheads(canvas, lines, pageIndex, staffIndex) {
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  const staffSpacing = (lines[4] - lines[0]) / 4;
  // Remove staff rules from the binary image before connected-component analysis.
  const black = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    if ((data[p] + data[p + 1] + data[p + 2]) / 3 < 110) black[y * width + x] = 1;
  }
  for (const lineY of lines) {
    for (let dy = -1; dy <= 1; dy++) {
      const y = lineY + dy;
      if (y >= 0 && y < height) black.fill(0, y * width, (y + 1) * width);
    }
  }
  const top = Math.max(0, Math.floor(lines[0] - staffSpacing * 2.5));
  const bottom = Math.min(height, Math.ceil(lines[4] + staffSpacing * 2));
  const visited = new Uint8Array(width * height);
  const candidates = [];
  const minArea = Math.max(7, staffSpacing * staffSpacing * .12);
  const maxArea = staffSpacing * staffSpacing * 3.5;
  for (let y = top; y < bottom; y++) for (let x = 2; x < width - 2; x++) {
    const start = y * width + x;
    if (!black[start] || visited[start]) continue;
    const stack = [start]; visited[start] = 1;
    let minX = x, maxX = x, minY = y, maxY = y, area = 0, sumX = 0, sumY = 0;
    while (stack.length) {
      const at = stack.pop(), px = at % width, py = Math.floor(at / width);
      area++; sumX += px; sumY += py;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || nx >= width || ny < top || ny >= bottom) continue;
        const ni = ny * width + nx;
        if (black[ni] && !visited[ni]) { visited[ni] = 1; stack.push(ni); }
      }
      // A single connected component cannot reasonably be a notehead if it grows this large.
      if (area > maxArea * 3) { stack.length = 0; area = -1; }
    }
    if (area < minArea || area > maxArea) continue;
    const w = maxX - minX + 1, h = maxY - minY + 1, ratio = w / h;
    if (ratio < 1.05 || ratio > 2.7 || w > staffSpacing * 2.7 || h > staffSpacing * 1.7) continue;
    candidates.push({ x: sumX / area, y: sumY / area, area, w, h });
  }
  candidates.sort((a, b) => a.x - b.x);
  const notes = [];
  const seen = [];
  for (const c of candidates) {
    if (seen.some(p => Math.abs(p.x - c.x) < staffSpacing * .65 && Math.abs(p.y - c.y) < staffSpacing * .65)) continue;
    seen.push(c);
    // This is an approximate treble-clef mapping. Bass clef, key signatures, accidentals,
    // ties, voices, beams and exact rhythms need a full OMR model and are not guessed here.
    const halfSteps = Math.round((lines[4] - c.y) / (staffSpacing / 2));
    const trebleSteps = ['E4','F4','G4','A4','B4','C5','D5','E5','F5','G5','A5','B5','C6','D6','E6','F6'];
    const note = trebleSteps[halfSteps];
    if (note) notes.push({ note, x: c.x, y: c.y, page: pageIndex + 1, staff: staffIndex + 1, confidence: 'low', duration: .5 });
  }
  return notes;
}

export async function recognizeScoreFile(file, onProgress = () => {}) {
  const lower = file.name.toLowerCase();
  let canvases;
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) canvases = await pdfCanvases(file, (p, total) => onProgress('Rendering PDF page ' + p + ' of ' + total + '…'));
  else if (file.type === 'image/svg+xml' || lower.endsWith('.svg')) canvases = [await imageCanvas(new File([file], file.name, { type: 'image/svg+xml' }))];
  else canvases = [await imageCanvas(file)];
  const all = [];
  let staffCount = 0;
  canvases.forEach((canvas, pageIndex) => {
    const staffs = findStaffLines(canvas);
    staffCount += staffs.length;
    staffs.forEach((lines, staffIndex) => all.push(...detectNoteheads(canvas, lines, pageIndex, staffIndex)));
    onProgress('Scanning page ' + (pageIndex + 1) + ' of ' + canvases.length + '…');
  });
  if (!staffCount) throw new Error('Could not find five clear, evenly spaced staff lines. Try a straight, high-resolution scan with strong contrast.');
  if (!all.length) throw new Error('Staff lines were found, but noteheads could not be separated confidently. This score may need a trained OMR model or manual correction.');
  return { notes: all, pages: canvases.length, staffs: staffCount, experimental: true };
}

export function readTrebleStaffImage({ data, width, height }) {
  const rowHits = [];
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if ((data[p] + data[p + 1] + data[p + 2]) / 3 < 100) count++;
    }
    if (count > width * .65) rowHits.push(y);
  }
  const staffLines = [];
  for (const y of rowHits) {
    if (!staffLines.length || y - staffLines[staffLines.length - 1] > 1) staffLines.push(y);
  }
  if (staffLines.length < 5) throw new Error('Could not find five clear staff lines.');
  const lines = staffLines.slice(0, 5);
  const spacing = (lines[4] - lines[0]) / 4;
  const visited = new Uint8Array(width * height);
  const notes = [];
  for (let y = Math.max(0, lines[0] - spacing); y < Math.min(height, lines[4] + spacing); y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      const p = start * 4;
      if (visited[start] || (data[p] + data[p + 1] + data[p + 2]) / 3 >= 100) continue;
      const stack = [start], pixels = []; visited[start] = 1;
      while (stack.length) {
        const at = stack.pop(), px = at % width, py = Math.floor(at / width);
        pixels.push([px, py]);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, ni = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || visited[ni]) continue;
          const q = ni * 4;
          if ((data[q] + data[q + 1] + data[q + 2]) / 3 < 100) { visited[ni] = 1; stack.push(ni); }
        }
      }
      const xs = pixels.map(v => v[0]), ys = pixels.map(v => v[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = maxX - minX + 1, h = maxY - minY + 1;
      if (pixels.length < 15 || pixels.length > spacing * spacing * 3.5 || w / h < 1.2 || w / h > 2.2) continue;
      const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      const pitch = Math.round((lines[4] - cy) / (spacing / 2));
      const map = ['E4','F4','G4','A4','B4','C5','D5','E5','F5','G5','A5','B5','C6'];
      if (map[pitch]) notes.push({ note: map[pitch], x: (minX + maxX) / 2, y: cy });
    }
  }
  notes.sort((a, b) => a.x - b.x);\n  return { staffLines: lines, notes, warning: 'Experimental: treble staff only.' };
}
