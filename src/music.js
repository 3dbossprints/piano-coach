export const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function midiToNote(midi) { const n=Math.round(midi); return NOTES[((n%12)+12)%12]+(Math.floor(n/12)-1); }
export function noteToMidi(input) {
  const m=String(input).trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)$/);
  if(!m) return null;
  let semis={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()];
  if(['#','♯'].includes(m[2])) semis++; if(['b','♭'].includes(m[2])) semis--;
  const midi=(Number(m[3])+1)*12+semis;
  return midi>=21&&midi<=108?midi:null;
}
export function clampKeyboardStartMidi(noteOrMidi, octaves = 3) {
  const range = Math.max(2, Math.min(5, Math.round(Number(octaves) || 3)));
  const parsed = typeof noteOrMidi === 'number' ? noteOrMidi : noteToMidi(noteOrMidi);
  const midi = Number.isFinite(parsed) ? Math.round(parsed) : 48;
  // Preserve the requested first note across octave-count changes whenever the
  // physical 88-key piano has room for the selected visible range.
  return Math.max(21, Math.min(108 - range * 12, midi));
}
export function parseSequence(text) {
  return String(text).split(/[\s,;]+/).filter(Boolean).map(token=>({token,midi:noteToMidi(token)}));
}
export function compareSequences(expected, actual) {
  const a=parseSequence(expected).filter(n=>n.midi!==null), b=actual||[];
  let correct=0; const rows=[];
  for(let i=0;i<Math.max(a.length,b.length);i++){
    const e=a[i],p=b[i],playedMidi=p?.midi??noteToMidi(p?.note); const status=!e?'extra':!p?'missed':e.midi===playedMidi?'correct':'incorrect';
    if(status==='correct')correct++;
    rows.push({expected:e?.token||'—',played:p?.note||'—',status});
  }
  return {rows,correct,total:a.length,accuracy:a.length?Math.round(correct/a.length*100):0};
}
