import test from 'node:test';
import assert from 'node:assert/strict';
import { midiNotesToMusicXML } from './midi-to-musicxml.js';

test('creates a grand-staff MusicXML score for left and right hand MIDI notes', () => {
  const xml = midiNotesToMusicXML([
    { midi: 48, note: 'C3', hand: 'left', time: 0, duration: 0.25 },
    { midi: 60, note: 'C4', hand: 'right', time: 0, duration: 0.5 },
    { midi: 64, note: 'E4', hand: 'right', time: 0, duration: 0.5 },
    { midi: 67, note: 'G4', hand: 'right', time: 0.5, duration: 0.5 },
    { midi: 52, note: 'E3', hand: 'left', time: 2.1, duration: 0.5 },
  ], 120, '4/4', 'Test & score');
  assert.match(xml, /<clef number="1"><sign>G<\/sign><line>2<\/line><\/clef>/);
  assert.match(xml, /<clef number="2"><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.match(xml, /<work-title>Test &amp; score<\/work-title>/);
  assert.equal((xml.match(/<pitch>/g) || []).length, 5);
  assert.match(xml, /<chord\/>/);
  assert.match(xml, /<backup>/);
  assert.match(xml, /<measure number="2">/);
});

test('keeps a note extending across a bar with tie markings', () => {
  const xml = midiNotesToMusicXML([
    { midi: 60, hand: 'right', time: 1.75, duration: 0.5 }
  ], 120, '4/4');
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tie type="stop"\/>/);
});

test('rejects empty MIDI note arrays', () => {
  assert.throws(() => midiNotesToMusicXML([], 120), /no pitched note events/i);
});
