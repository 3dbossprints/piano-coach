const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function midiName(midi) {
  const n = Math.max(0, Math.min(127, Math.round(Number(midi) || 0)));
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}
export function isBlackKey(midi) { return [1, 3, 6, 8, 10].includes(Number(midi) % 12); }

export function buildKeystoneOrder(measures) {
  const out = [], counts = {}, segno = {}, coda = {};
  measures.forEach((m, i) => { if (m.segno) segno[m.segno] ??= i; if (m.coda) coda[m.coda] ??= i; });
  let i = 0, repeatStart = 0, pass = 1, jumped = false, guard = 0;
  while (i < measures.length && out.length < 4000 && guard++ < 12000) {
    const m = measures[i];
    if (m.ending && !m.ending.includes(pass)) { i++; continue; }
    if (m.repeatForward && !jumped) repeatStart = i;
    out.push(i);
    if (jumped && m.fine) break;
    if (jumped && m.toCoda && coda[m.toCoda] != null && coda[m.toCoda] !== i) { i = coda[m.toCoda]; continue; }
    if (m.repeatBackward && !jumped) {
      const count = counts[i] || 0;
      if (count < Math.max(1, m.repeatTimes || 2) - 1) {
        counts[i] = count + 1; pass = count + 2; i = repeatStart; continue;
      }
      counts[i] = 0; pass = 1; repeatStart = i + 1;
    } else if (m.ending && !measures[i + 1]?.ending) pass = 1;
    if (!jumped && (m.daCapo || m.dalSegno)) {
      const target = m.daCapo ? 0 : segno[m.dalSegno];
      if (target != null) { jumped = true; i = target; pass = 2; continue; }
    }
    i++;
  }
  return out;
}

export function buildKeystoneTimeline(parsed) {
  let elapsed = 0;
  const events = [];
  parsed.order.forEach((measureIndex, orderIndex) => {
    const measure = parsed.measures[measureIndex];
    const secondsPerBeat = 60 / Math.max(20, Number(measure.bpm || parsed.bpm) || 120);
    measure.notes.forEach((note, noteIndex) => events.push({
      midi: note.midi, note: midiName(note.midi), t: elapsed + note.offset * secondsPerBeat,
      d: Math.max(0.04, note.duration * secondsPerBeat), hand: note.hand,
      measure: measure.number || measureIndex + 1, orderIndex, noteIndex
    }));
    elapsed += Math.max(0.25, measure.length || 4) * secondsPerBeat;
  });
  return events.sort((a, b) => a.t - b.t || a.midi - b.midi);
}

export function parseKeystoneMusicXML(xmlText) {
  if (typeof DOMParser === 'undefined') throw new Error('MusicXML parsing requires a browser XML parser.');
  const doc = new DOMParser().parseFromString(String(xmlText || ''), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The MusicXML file is not valid XML.');
  const parts = [...doc.querySelectorAll('score-partwise > part, part-list ~ part')];
  if (!parts.length) throw new Error('No MusicXML parts were found.');
  const measures = [];
  const openTies = new Map();
  let fallbackTempo = 120;
  parts.forEach((part, partIndex) => {
    let divisions = 1, endingNumbers = null;
    [...part.children].filter(el => el.localName === 'measure').forEach((measureEl, measureIndex) => {
      const measure = measures[measureIndex] ??= {
        number: Number(measureEl.getAttribute('number')) || measureIndex + 1,
        length: 0, bpm: 0, notes: [], repeatForward: false, repeatBackward: false,
        repeatTimes: 2, ending: null, segno: null, coda: null, daCapo: false,
        dalSegno: null, toCoda: null, fine: false
      };
      let cursor = 0, maxCursor = 0, lastStart = 0, stopEnding = false;
      const applySound = sound => {
        if (!sound) return;
        const tempo = Number(sound.getAttribute('tempo'));
        if (tempo > 0) measure.bpm ||= tempo;
        if (sound.getAttribute('segno')) measure.segno ||= sound.getAttribute('segno');
        if (sound.getAttribute('coda')) measure.coda ||= sound.getAttribute('coda');
        if (sound.getAttribute('dacapo') === 'yes') measure.daCapo = true;
        if (sound.getAttribute('dalsegno')) measure.dalSegno ||= sound.getAttribute('dalsegno');
        if (sound.getAttribute('tocoda')) measure.toCoda ||= sound.getAttribute('tocoda');
        if (sound.getAttribute('fine')) measure.fine = true;
      };
      if (endingNumbers && !measure.ending) measure.ending = endingNumbers;
      for (const child of [...measureEl.children]) {
        const tag = child.localName;
        if (tag === 'attributes') {
          const d = Number(child.querySelector(':scope > divisions')?.textContent);
          if (d > 0) divisions = d;
        } else if (tag === 'backup' || tag === 'forward') {
          const duration = Number(child.querySelector('duration')?.textContent || 0);
          cursor = tag === 'backup' ? cursor - duration : cursor + duration;
        } else if (tag === 'sound') {
          applySound(child);
        } else if (tag === 'barline') {
          const repeat = child.querySelector('repeat'), ending = child.querySelector('ending');
          if (repeat) {
            if (repeat.getAttribute('direction') === 'forward') measure.repeatForward = true;
            else {
              measure.repeatBackward = true;
              measure.repeatTimes = Number(repeat.getAttribute('times')) || 2;
            }
          }
          if (ending) {
            const type = ending.getAttribute('type');
            if (type === 'start') {
              endingNumbers = String(ending.getAttribute('number') || '1').split(/[ ,]+/).map(Number).filter(Number.isFinite);
              measure.ending = endingNumbers;
            } else if (type === 'stop') stopEnding = true;
          }
        } else if (tag === 'direction') {
          applySound(child.querySelector('sound'));
          const sound = child.querySelector('sound');
          if (child.querySelector('segno')) measure.segno ||= '_segno';
          if (child.querySelector('coda')) measure.coda ||= '_coda';
          const words = (child.querySelector('words')?.textContent || '').trim();
          if (!sound && words) {
            if (/^d\.?\s?c\.?/i.test(words)) measure.daCapo = true;
            else if (/^d\.?\s?s\.?/i.test(words)) measure.dalSegno ||= '_segno';
            if (/to coda/i.test(words)) measure.toCoda ||= '_coda';
            if (/^fine$/i.test(words)) measure.fine = true;
          }
        } else if (tag === 'note') {
          const duration = Number(child.querySelector(':scope > duration')?.textContent || 0);
          const chord = !!child.querySelector(':scope > chord');
          const grace = !!child.querySelector(':scope > grace');
          const pitch = child.querySelector(':scope > pitch');
          if (!pitch || grace) { if (!chord && !grace) cursor += duration; maxCursor = Math.max(maxCursor, cursor); continue; }
          const step = pitch.querySelector('step')?.textContent?.trim();
          const octave = Number(pitch.querySelector('octave')?.textContent);
          if (!(step in STEP) || !Number.isFinite(octave)) { if (!chord) cursor += duration; continue; }
          const midi = 12 * (octave + 1) + STEP[step] + Number(pitch.querySelector('alter')?.textContent || 0);
          const onset = chord ? lastStart : cursor;
          if (!chord) { lastStart = cursor; cursor += duration; }
          const key = partIndex + ':' + midi;
          const tieStart = !!child.querySelector(':scope > tie[type="start"]');
          const tieStop = !!child.querySelector(':scope > tie[type="stop"]');
          if (tieStop && openTies.has(key)) {
            const existing = openTies.get(key);
            existing.duration += duration / divisions;
            if (!tieStart) openTies.delete(key);
          } else {
            const staff = Number(child.querySelector(':scope > staff')?.textContent || 1);
            const entry = {
              midi, offset: onset / divisions, duration: Math.max(duration, divisions / 4) / divisions,
              hand: parts.length > 1 ? (partIndex === 0 ? 'right' : 'left') : (staff > 1 ? 'left' : 'right')
            };
            measure.notes.push(entry);
            if (tieStart) openTies.set(key, entry);
          }
          maxCursor = Math.max(maxCursor, cursor);
        }
        maxCursor = Math.max(maxCursor, cursor);
      }
      if (stopEnding) endingNumbers = null;
      measure.length = Math.max(measure.length, maxCursor / divisions);
    });
  });
  measures.forEach(measure => {
    if (!measure.length) measure.length = 4;
    if (measure.bpm) fallbackTempo = measure.bpm;
    else measure.bpm = fallbackTempo;
  });
  if (!measures.some(measure => measure.notes.length)) throw new Error('No pitched notes were found in this MusicXML score.');
  const order = buildKeystoneOrder(measures);
  if (!order.length) throw new Error('The MusicXML repeat and ending structure produced no playable measures.');
  return { measures, order, bpm: fallbackTempo };
}

export function scoreNotesToKeystoneTimeline(notes, bpm = 120) {
  const safeBpm = Math.max(20, Number(bpm) || 120);
  const list = (Array.isArray(notes) ? notes : []).filter(n => n && n.note && n.note !== 'rest' && Number.isFinite(Number(n.midi ?? noteToMidiFallback(n.note))));
  return list.map((n, index) => {
    const midi = Number(n.midi ?? noteToMidiFallback(n.note));
    const time = Math.max(0, Number(n.time) || 0);
    const duration = Math.max(0.04, Number(n.duration) || (Number(n.beats) || 1) * 60 / safeBpm);
    return { midi, note: midiName(midi), t: time, d: duration, hand: n.hand || (midi < 60 ? 'left' : 'right'), measure: Number(n.measure) || Math.floor(time / (60 / safeBpm * 4)) + 1, orderIndex: 0, noteIndex: index };
  }).sort((a, b) => a.t - b.t || a.midi - b.midi);
}
function noteToMidiFallback(note) {
  const match = String(note || '').match(/^([A-G])(#|b)?(-?\d)$/i);
  if (!match) return null;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return 12 * (Number(match[3]) + 1) + semitones[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}
