const STEPS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALTERATIONS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const DIVISIONS = 960;
const SIMULTANEOUS_TOLERANCE = 0.035;

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function pitchForMidi(value) {
  const midi = Math.max(0, Math.min(127, Math.round(Number(value))));
  const pitchClass = midi % 12;
  return {
    step: STEPS[pitchClass],
    alter: ALTERATIONS[pitchClass],
    octave: Math.floor(midi / 12) - 1
  };
}

function rhythmForBeats(beats) {
  const choices = [
    { beats: 4, type: 'whole' },
    { beats: 3, type: 'half', dots: 1 },
    { beats: 2, type: 'half' },
    { beats: 1.5, type: 'quarter', dots: 1 },
    { beats: 1, type: 'quarter' },
    { beats: 0.75, type: 'eighth', dots: 1 },
    { beats: 0.5, type: 'eighth' },
    { beats: 0.375, type: '16th', dots: 1 },
    { beats: 0.25, type: '16th' },
    { beats: 0.125, type: '32nd' },
    { beats: 0.0625, type: '64th' }
  ];
  return choices.reduce((best, choice) =>
    Math.abs(choice.beats - beats) < Math.abs(best.beats - beats) ? choice : best
  , choices[0]);
}

function makeSegments(notes, bpm, beatsPerBar) {
  const result = [];
  for (const note of notes) {
    const midi = Number(note?.midi);
    const start = Number(note?.time) * bpm / 60;
    const rawDuration = Number(note?.duration) * bpm / 60;
    if (!Number.isFinite(midi) || midi < 0 || midi > 127 ||
        !Number.isFinite(start) || !Number.isFinite(rawDuration) || rawDuration <= 0) continue;
    const end = Math.max(start + 0.0625, start + rawDuration);
    let segmentStart = Math.max(0, start);
    let first = true;
    while (segmentStart < end - 0.000001) {
      const measureIndex = Math.floor(segmentStart / beatsPerBar);
      const measureEnd = (measureIndex + 1) * beatsPerBar;
      const segmentEnd = Math.min(end, measureEnd);
      result.push({
        midi: Math.round(midi),
        staff: note.hand === 'left' || (note.hand !== 'right' && midi < 60) ? 2 : 1,
        start: segmentStart,
        duration: Math.max(0.0625, segmentEnd - segmentStart),
        measureIndex,
        tieStop: !first,
        tieStart: segmentEnd < end - 0.000001
      });
      first = false;
      segmentStart = segmentEnd;
    }
  }
  return result;
}

function groupSimultaneous(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const groups = [];
  for (const item of sorted) {
    const current = groups[groups.length - 1];
    if (current && item.start - current.firstStart <= SIMULTANEOUS_TOLERANCE) {
      current.items.push(item);
    } else {
      groups.push({ firstStart: item.start, items: [item] });
    }
  }
  return groups.map(group => {
    const starts = group.items.map(item => item.start).sort((a, b) => a - b);
    const start = starts[Math.floor(starts.length / 2)];
    return {
      start,
      items: group.items,
      duration: Math.max(...group.items.map(item => item.duration))
    };
  });
}

function assignVoices(groups) {
  const voices = [];
  for (const group of groups) {
    let voice = voices.find(item => item.end <= group.start + 0.0005);
    if (!voice) {
      voice = { number: voices.length + 1, end: 0, groups: [] };
      voices.push(voice);
    }
    voice.groups.push(group);
    voice.end = group.start + group.duration;
    group.voice = voice.number;
  }
  return voices;
}

function noteXml(item, voice, staff, chord) {
  const pitch = pitchForMidi(item.midi);
  const type = rhythmForBeats(item.duration);
  const duration = Math.max(1, Math.round(item.duration * DIVISIONS));
  const ties = (item.tieStop ? '<tie type="stop"/>' : '') +
    (item.tieStart ? '<tie type="start"/>' : '');
  const tiedNotation = (item.tieStop ? '<tied type="stop"/>' : '') +
    (item.tieStart ? '<tied type="start"/>' : '');
  return '<note>' +
    (chord ? '<chord/>' : '') +
    '<pitch><step>' + pitch.step + '</step>' +
    (pitch.alter ? '<alter>' + pitch.alter + '</alter>' : '') +
    '<octave>' + pitch.octave + '</octave></pitch>' +
    '<duration>' + duration + '</duration>' + ties +
    '<voice>' + voice + '</voice><type>' + type.type + '</type>' +
    (type.dots ? '<dot/>' : '') +
    '<staff>' + staff + '</staff>' +
    (tiedNotation ? '<notations>' + tiedNotation + '</notations>' : '') +
    '</note>';
}

function voiceXml(voice, staff, measureStart, beatsPerBar) {
  const barTicks = Math.round(beatsPerBar * DIVISIONS);
  let cursor = 0;
  let body = '';
  for (const group of voice.groups) {
    const offset = Math.max(0, Math.min(barTicks, Math.round((group.start - measureStart) * DIVISIONS)));
    if (offset > cursor) {
      body += '<forward><duration>' + (offset - cursor) + '</duration><voice>' +
        voice.number + '</voice><staff>' + staff + '</staff></forward>';
      cursor = offset;
    }
    const notes = group.items;
    let groupEnd = cursor;
    notes.forEach((note, index) => {
      const maxDuration = Math.max(1, barTicks - offset);
      const clipped = { ...note, duration: Math.min(note.duration, maxDuration / DIVISIONS) };
      body += noteXml(clipped, voice.number, staff, index > 0);
      groupEnd = Math.max(groupEnd, offset + Math.round(clipped.duration * DIVISIONS));
    });
    cursor = Math.max(cursor, groupEnd);
  }
  if (cursor < barTicks) {
    body += '<forward><duration>' + (barTicks - cursor) + '</duration><voice>' +
      voice.number + '</voice><staff>' + staff + '</staff></forward>';
  }
  return body;
}

/**
 * Build a two-staff piano MusicXML score from parsed MIDI note events.
 * Event times and durations are seconds; bpm is quarter-notes per minute.
 */
export function midiNotesToMusicXML(notes, bpm = 120, timeSignature = '4/4', title = 'Imported MIDI score') {
  const safeBpm = Math.max(20, Math.min(400, Number(bpm) || 120));
  const match = String(timeSignature || '4/4').match(/^(\d+)\s*\/\s*(\d+)$/);
  const beats = match ? Math.max(1, Math.min(32, Number(match[1]))) : 4;
  const beatType = match ? Math.max(1, Math.min(32, Number(match[2]))) : 4;
  const beatsPerBar = beats * 4 / beatType;
  const segments = makeSegments(Array.isArray(notes) ? notes : [], safeBpm, beatsPerBar);
  if (!segments.length) throw new Error('Cannot create notation because the MIDI contains no pitched note events.');

  const measureCount = Math.max(1, ...segments.map(item => item.measureIndex + 1));
  const byStaff = {
    1: segments.filter(item => item.staff === 1),
    2: segments.filter(item => item.staff === 2)
  };
  const measures = [];
  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    const measureStart = measureIndex * beatsPerBar;
    let body = '';
    if (measureIndex === 0) {
      body += '<attributes><divisions>' + DIVISIONS + '</divisions>' +
        '<time><beats>' + beats + '</beats><beat-type>' + beatType + '</beat-type></time>' +
        '<staves>2</staves>' +
        '<clef number="1"><sign>G</sign><line>2</line></clef>' +
        '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>' +
        '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>' +
        '<per-minute>' + safeBpm + '</per-minute></metronome></direction-type>' +
        '<sound tempo="' + safeBpm + '"/></direction>';
    }
    const timelines = [];
    for (const staff of [1, 2]) {
      const groups = groupSimultaneous(byStaff[staff].filter(item => item.measureIndex === measureIndex));
      const voices = assignVoices(groups);
      for (const voice of voices) timelines.push({ staff, voice });
    }
    const barTicks = Math.round(beatsPerBar * DIVISIONS);
    timelines.forEach((timeline, index) => {
      body += voiceXml(timeline.voice, timeline.staff, measureStart, beatsPerBar);
      if (index < timelines.length - 1) body += '<backup><duration>' + barTicks + '</duration></backup>';
    });
    body += '<barline location="right"><bar-style>regular</bar-style></barline>';
    measures.push('<measure number="' + (measureIndex + 1) + '">' + body + '</measure>');
  }

  const safeTitle = xml(title || 'Imported MIDI score');
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<score-partwise version="3.1"><work><work-title>' + safeTitle + '</work-title></work>' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name>' +
    '<score-instrument id="P1-I1"><instrument-name>Acoustic Grand Piano</instrument-name></score-instrument>' +
    '</score-part></part-list><part id="P1">' + measures.join('') +
    '</part></score-partwise>';
}
