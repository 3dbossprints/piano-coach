function vlq(value) {
  let remaining = Math.max(0, Math.round(value)) & 0x0fffffff;
  const bytes = [remaining & 0x7f];
  while ((remaining >>= 7)) bytes.unshift((remaining & 0x7f) | 0x80);
  return bytes;
}

function ascii(value) {
  return Array.from(value, character => character.charCodeAt(0));
}

export function encodeNotesAsMidi(notes, { bpm = 120, ticksPerBeat = 480 } = {}) {
  const tempo = Math.max(20, Math.min(300, Number(bpm) || 120));
  const valid = (Array.isArray(notes) ? notes : []).filter(note =>
    Number.isFinite(Number(note.midi)) &&
    Number(note.midi) >= 21 && Number(note.midi) <= 108 &&
    Number.isFinite(Number(note.time)) && Number(note.time) >= 0 &&
    Number.isFinite(Number(note.duration)) && Number(note.duration) > 0
  );
  if (!valid.length) throw new Error('The transcription did not contain any valid piano-range notes.');

  const ticksPerSecond = ticksPerBeat * tempo / 60;
  const events = [];
  for (const note of valid) {
    const pitch = Math.round(Number(note.midi));
    const start = Math.max(0, Math.round(Number(note.time) * ticksPerSecond));
    const end = Math.max(start + 1, Math.round((Number(note.time) + Number(note.duration)) * ticksPerSecond));
    const confidence = Number(note.velocity);
    const velocity = Math.max(1, Math.min(127, Math.round((Number.isFinite(confidence) ? confidence : 0.7) * 127)));
    events.push({ tick: start, priority: 1, bytes: [0x90, pitch, velocity] });
    events.push({ tick: end, priority: 0, bytes: [0x80, pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.priority - b.priority || a.bytes[1] - b.bytes[1]);

  const microsecondsPerBeat = Math.round(60000000 / tempo);
  const track = [
    0, 0xff, 0x51, 0x03,
    (microsecondsPerBeat >> 16) & 255,
    (microsecondsPerBeat >> 8) & 255,
    microsecondsPerBeat & 255,
    0, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08
  ];
  let previousTick = 0;
  for (const event of events) {
    track.push(...vlq(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  const header = [...ascii('MThd'), 0, 0, 0, 6, 0, 0, 0, 1, (ticksPerBeat >> 8) & 255, ticksPerBeat & 255];
  const chunk = [...ascii('MTrk'), (track.length >>> 24) & 255, (track.length >>> 16) & 255, (track.length >>> 8) & 255, track.length & 255, ...track];
  return new Blob([new Uint8Array([...header, ...chunk])], { type: 'audio/midi' });
}
