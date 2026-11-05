/**
 * Lightweight guard for camera captures: look for five approximately parallel,
 * evenly spaced staff lines before sending a photo to optical music recognition.
 * This intentionally rejects obvious non-score frames (walls, ceilings, desks),
 * while leaving detailed notation recognition to HOMR.
 */
export function hasMusicStaffLines(imageData) {
  if (!imageData?.data || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height)) return false;
  const { data, width, height } = imageData;
  if (width < 80 || height < 80 || data.length < width * height * 4) return false;

  const scale = Math.min(1, 640 / width, 480 / height);
  const sampleWidth = Math.max(1, Math.floor(width * scale));
  const sampleHeight = Math.max(1, Math.floor(height * scale));
  const xStart = Math.floor(sampleWidth * 0.08);
  const xEnd = Math.ceil(sampleWidth * 0.92);
  const span = xEnd - xStart;
  const candidates = [];

  for (let y = Math.floor(sampleHeight * 0.08); y < Math.ceil(sampleHeight * 0.92); y++) {
    let dark = 0;
    for (let x = xStart; x < xEnd; x++) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const sourceY = Math.min(height - 1, Math.floor(y / scale));
      const offset = (sourceY * width + sourceX) * 4;
      const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
      if (luminance < 105) dark++;
    }
    // A staff line should span a substantial part of the page, unlike text
    // strokes or isolated objects.
    if (dark / span >= 0.34) candidates.push(y);
  }

  if (candidates.length < 5) return false;
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
