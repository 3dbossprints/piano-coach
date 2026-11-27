/**
 * Lightweight camera-frame validation before running optical music recognition.
 * Detect five evenly spaced staff lines and tolerate small page skew, faint ink,
 * and the uneven lighting common in phone photographs.
 */
export function hasMusicStaffLines(imageData) {
  if (!imageData?.data || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height)) return false;
  const { data, width, height } = imageData;
  if (width < 80 || height < 80 || data.length < width * height * 4) return false;

  const scale = Math.min(1, 640 / width, 480 / height);
  const sampleWidth = Math.max(1, Math.floor(width * scale));
  const sampleHeight = Math.max(1, Math.floor(height * scale));
  const xStart = Math.floor(sampleWidth * 0.06);
  const xEnd = Math.ceil(sampleWidth * 0.94);
  const span = xEnd - xStart;
  const centreX = (xStart + xEnd) / 2;
  const firstY = Math.floor(sampleHeight * 0.06);
  const lastY = Math.ceil(sampleHeight * 0.94);

  // A phone rarely holds a page perfectly level. Test a small range of angles
  // so a sloping staff still produces five clear horizontal projection peaks.
  for (let angle = -3; angle <= 3.001; angle += 0.5) {
    const slope = Math.tan(angle * Math.PI / 180);
    const candidates = [];

    for (let y = firstY; y < lastY; y++) {
      let dark = 0;
      let sampled = 0;
      for (let x = xStart; x < xEnd; x++) {
        const alignedY = Math.round(y + slope * (x - centreX));
        if (alignedY < 0 || alignedY >= sampleHeight) continue;
        const sourceX = Math.min(width - 1, Math.floor(x / scale));
        const sourceY = Math.min(height - 1, Math.floor(alignedY / scale));
        const offset = (sourceY * width + sourceX) * 4;
        const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
        if (luminance < 165) dark++;
        sampled++;
      }
      // Staff rules should occupy a meaningful part of the scanline. A lower
      // threshold than before accepts lighter printing without accepting dots.
      if (sampled && dark / sampled >= 0.28) candidates.push(y);
    }

    if (candidates.length < 5) continue;
    const rows = [];
    for (const y of candidates) {
      const last = rows[rows.length - 1];
      if (last && y - last.end <= 1) last.end = y;
      else rows.push({ start: y, end: y });
    }
    const lines = rows.map(row => Math.round((row.start + row.end) / 2));
    for (let i = 0; i <= lines.length - 5; i++) {
      const gaps = [1, 2, 3, 4].map(j => lines[i + j] - lines[i + j - 1]);
      if (gaps.some(gap => gap < 2 || gap > 24)) continue;
      const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      if (gaps.every(gap => Math.abs(gap - average) <= Math.max(2, average * 0.55))) return true;
    }
  }
  return false;
}

export function friendlyRecognitionError(error) {
  const detail = String(error?.message || error || '');
  if (/cv2\.error|opencv|resize\.cpp|center_image_on_canvas/i.test(detail)) {
    return 'The page could not be straightened for recognition. Retake it straight-on with all four page edges visible, good lighting and no shadows.';
  }
  if (/no staff|no music|no score|not a score|empty page|no notation/i.test(detail)) {
    return 'No readable sheet music was found. Make sure the whole page is visible, in focus and well lit, then try again.';
  }
  if (/memory|out of memory|allocation failed/i.test(detail)) {
    return 'This image is too demanding for the available device memory. Try a smaller, clearer image or a PDF scan.';
  }
  return 'The sheet could not be converted. Check that it is a clear, unmarked page of printed music and try again with a straight-on photo.';
}
