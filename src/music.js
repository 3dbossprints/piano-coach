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
export function compareSequences(expected, actual, bpm = 120) {
  const durationBeats = { w: 4, whole: 4, h: 2, half: 2, q: 1, quarter: 1, e: 0.5, eighth: 0.5, s: 0.25, sixteenth: 0.25 };
  const safeBpm = Math.max(20, Math.min(300, Number(bpm) || 120));
  const beatSeconds = 60 / safeBpm;
  const target = [];
  let beatCursor = 0;
  for (const token of String(expected || '').split(/[\s,;]+/).filter(Boolean)) {
    const [pitch, durationToken] = token.split('/');
    const beats = durationBeats[String(durationToken || 'q').toLowerCase()] || 1;
    const midi = /^r(est)?$/i.test(pitch) ? null : noteToMidi(pitch);
    if (midi !== null) target.push({ token: pitch, midi, beats, beat: beatCursor });
    beatCursor += beats;
  }
  const played = Array.isArray(actual) ? actual : [];
  const firstPlayedTime = played.map(note => Number(note?.time)).find(Number.isFinite);
  let correct = 0, pitchErrors = 0, missed = 0, extra = 0, timingIssues = 0;
  const timingAvailable = played.some(note => Number.isFinite(Number(note?.time)) || Number.isFinite(Number(note?.duration)));
  const rows = [];
  for (let i = 0; i < Math.max(target.length, played.length); i++) {
    const expectedNote = target[i], playedNote = played[i];
    const playedMidi = playedNote?.midi ?? noteToMidi(playedNote?.note);
    const pitchStatus = !expectedNote ? 'extra' : !playedNote ? 'missed' : expectedNote.midi === playedMidi ? 'correct' : 'incorrect';
    if (pitchStatus === 'correct') correct++;
    else if (pitchStatus === 'incorrect') pitchErrors++;
    else if (pitchStatus === 'missed') missed++;
    else extra++;
    let onsetError = null, durationError = null, timingStatus = 'unavailable';
    if (expectedNote && playedNote && timingAvailable) {
      const actualStart = Number(playedNote.time);
      if (Number.isFinite(actualStart) && Number.isFinite(firstPlayedTime)) {
        onsetError = (actualStart - firstPlayedTime) - expectedNote.beat * beatSeconds;
      }
      const actualDuration = Number(playedNote.duration);
      if (Number.isFinite(actualDuration) && actualDuration > 0) {
        durationError = actualDuration - expectedNote.beats * beatSeconds;
      }
      const onsetTolerance = Math.max(0.16, beatSeconds * 0.35);
      const durationTolerance = Math.max(0.18, expectedNote.beats * beatSeconds * 0.45);
      const offBeat = onsetError !== null && Math.abs(onsetError) > onsetTolerance;
      const wrongLength = durationError !== null && Math.abs(durationError) > durationTolerance;
      timingStatus = offBeat || wrongLength ? 'needs-work' : 'steady';
      if (timingStatus === 'needs-work') timingIssues++;
    }
    rows.push({
      expected: expectedNote?.token || '—',
      played: playedNote?.note || (playedMidi != null ? midiToNote(playedMidi) : '—'),
      status: pitchStatus,
      timingStatus,
      onsetError,
      durationError
    });
  }
  return {
    rows, correct, total: target.length,
    accuracy: target.length ? Math.round(correct / target.length * 100) : 0,
    pitchErrors, missed, extra, timingIssues, timingAvailable
  };
}


export function assignMidiHands(notes) {
  const items = Array.isArray(notes) ? notes : [];
  const tracks = [...new Set(items.map(note => Number(note.track)).filter(Number.isFinite))];
  if (tracks.length <= 1) {
    return items.map(note => ({ ...note, hand: Number(note.midi) < 60 ? 'left' : 'right' }));
  }
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 60;
  };
  const ranked = tracks.map(track => ({
    track,
    middle: median(items.filter(note => Number(note.track) === track).map(note => Number(note.midi)).filter(Number.isFinite))
  })).sort((a, b) => a.middle - b.middle || a.track - b.track);
  const leftTrackCount = Math.max(1, Math.floor(ranked.length / 2));
  const leftTracks = new Set(ranked.slice(0, leftTrackCount).map(item => item.track));
  return items.map(note => ({
    ...note,
    hand: leftTracks.has(Number(note.track)) ? 'left' : 'right'
  }));
}
