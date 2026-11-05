/* Piano Coach deterministic guardrails for the small, local language model. */
const THEORY_ANSWERS = [
  {
    match: /(?:fully\s+)?diminished[\s-]+seventh|dim(?:inished)?\s*7\b/i,
    exclude: /half[\s-]*diminished/i,
    answer: 'A fully diminished seventh chord is built from 1–♭3–♭5–♭♭7: a root, minor third, diminished fifth and diminished seventh (three stacked minor thirds). In C, that is C–E♭–G♭–B𝄫; B𝄫 sounds enharmonically like A on a piano.'
  },
  {
    match: /half[\s-]*diminished(?:\s+seventh)?|ø7/i,
    answer: 'A half-diminished seventh chord is built from 1–♭3–♭5–♭7: a root, minor third, diminished fifth and minor seventh. In C, that is C–E♭–G♭–B♭.'
  }
];

export function verifiedTheoryAnswer(question) {
  const text = String(question || '').trim();
  if (!text) return null;
  for (const item of THEORY_ANSWERS) {
    if (item.match.test(text) && (!item.exclude || !item.exclude.test(text))) return item.answer;
  }
  return null;
}

export function sanitizeTutorResponse(value) {
  let text = String(value ?? '').trim();
  if (!text) return '';
  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\{[^{}]{0,2000}"(?:expected|played|status)"[^{}]{0,2000}\}/gi, ' ');
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [];
  return sentences
    .map(sentence => sentence.trim())
    .filter(sentence => sentence &&
      !/(?:TRANSCRIPTION EVIDENCE|AUDIO MODEL REVIEW|Target comparison|Reference comparison)\s*:/i.test(sentence) &&
      !/(?:matched?|match(?:es|ed)?)\s+(?:all|the|\d+|four|five|six)?\s*(?:target\s+)?notes?|(?:target\s+)?notes?\s+(?:were\s+)?matched/i.test(sentence) &&
      !/\b(?:similarity|accuracy)\b.*\b\d{1,3}%/i.test(sentence) &&
      !/\b\d{1,3}%\s*(?:accurate|similar|correct|match)/i.test(sentence) &&
      !/\{\s*"(?:expected|played|status)"/i.test(sentence) &&
      !/(?:I am|I’m)\s+analysing\s+your\s+file/i.test(sentence))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
