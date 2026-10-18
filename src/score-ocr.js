// Lightweight experimental score-image reader for clean, single-staff treble-clef images.
// It is a computer-vision heuristic, not a trained AI OMR model. Always review the detected notes.
export function readTrebleStaffImage(imageData) {
  const { data, width, height } = imageData;
  if (!width || !height || data.length !== width * height * 4) throw new Error('Invalid score image.');
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
  const dark = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) dark[i] = gray[i] < 145 ? 1 : 0;
  const rowHits = new Uint32Array(height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rowHits[y] += dark[y * width + x];
  const lineThreshold = Math.max(10, Math.floor(width * 0.28));
  const candidates = [];
  for (let y = 0; y < height; y++) if (rowHits[y] >= lineThreshold) {
    if (candidates.length && y - candidates[candidates.length - 1].at(-1) <= 2) candidates[candidates.length - 1].push(y);
    else candidates.push([y]);
  }
  const lines = candidates.filter(group => group.reduce((sum, y) => sum + rowHits[y], 0) / group.length >= lineThreshold)
    .map(group => Math.round(group.reduce((a, b) => a + b, 0) / group.length));
  let staff = null, bestScore = -Infinity;
  for (let i = 0; i + 4 < lines.length; i++) {
    const five = lines.slice(i, i + 5), gaps = five.slice(1).map((v, j) => v - five[j]);
    const mean = gaps.reduce((a, b) => a + b, 0) / 4;
    const spread = Math.max(...gaps) - Math.min(...gaps);
    if (mean >= 5 && mean <= 35 && spread <= mean * 0.45) {
      const score = five.reduce((sum, y) => sum + rowHits[y], 0) - spread * 8;
      if (score > bestScore) { bestScore = score; staff = { lines: five, spacing: mean }; }
    }
  }
  if (!staff) throw new Error('Could not find five clear staff lines. Use a straight, high-contrast treble-clef score crop.');
  // Remove horizontal staff lines, then find compact dark connected components as notehead candidates.
  for (const y of staff.lines) for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy; if (yy >= 0 && yy < height) dark.fill(0, yy * width, (yy + 1) * width);
  }
  const top = Math.max(0, staff.lines[0] - staff.spacing * 2), bottom = Math.min(height - 1, staff.lines[4] + staff.spacing * 2);
  const seen = new Uint8Array(width * height), candidatesNotes = [];
  const minArea = Math.max(12, Math.round(staff.spacing * staff.spacing * 0.12));
  for (let y = Math.floor(top); y <= bottom; y++) for (let x = 0; x < width; x++) {
    const start = y * width + x;
    if (!dark[start] || seen[start]) continue;
    const stack = [start]; seen[start] = 1; let minX=x,maxX=x,minY=y,maxY=y,area=0,sumX=0,sumY=0;
    while (stack.length) {
      const p = stack.pop(), px = p % width, py = Math.floor(p / width);
      area++; sumX += px; sumY += py; minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
      for (let yy=Math.max(0,py-1); yy<=Math.min(height-1,py+1); yy++) for (let xx=Math.max(0,px-1);xx<=Math.min(width-1,px+1);xx++) {
        const q=yy*width+xx;if(dark[q]&&!seen[q]){seen[q]=1;stack.push(q)}
      }
    }
    const w=maxX-minX+1,h=maxY-minY+1,ratio=w/h;
    if(area>=minArea&&w>=staff.spacing*.45&&w<=staff.spacing*2.4&&h>=staff.spacing*.3&&h<=staff.spacing*1.6&&ratio>=0.55&&ratio<=2.2) candidatesNotes.push({x:sumX/area,y:sumY/area,area});
  }
  // Quantise notehead centres to half-spaces. Bottom line is E4 in treble clef.
  const bottomLine = staff.lines[4], stepPx = staff.spacing / 2;
  const notes = candidatesNotes.sort((a,b)=>a.x-b.x).filter((n,i,arr)=>i===0||n.x-arr[i-1].x>staff.spacing*.55).map(n=>{
    const steps=Math.round((bottomLine-n.y)/stepPx), diatonic=['E','F','G','A','B','C','D'];
    let letterIndex=2+steps, octave=4+Math.floor(letterIndex/7); // E is index 2 in C-based octave sequence
    const letters=['C','D','E','F','G','A','B'];
    const absolute=2+steps; octave=4+Math.floor(absolute/7); const letter=letters[((absolute%7)+7)%7];
    return { letter, octave, note:letter+octave, x:Math.round(n.x), y:Math.round(n.y) };
  });
  if (!notes.length) throw new Error('Staff found, but no clear noteheads were recognised. Try a tighter, higher-resolution crop.');
  return { notes, staffLines: staff.lines, spacing: staff.spacing, warning: 'Experimental notehead detection: accidentals, key signatures, rests, rhythm, chords, ledger lines and multiple staves may be missed. Review every note before comparing.' };
}
