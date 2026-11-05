/**
 * Turn raw waveform/transcription measurements into learner-facing feedback.
 * Keep diagnostic metrics out of the feedback panel and avoid claiming musical
 * accuracy or expression that the measurements cannot establish.
 */
export function summarizeAudioReview({ rms = 0, peak = 0, clippedRatio = 0, noteCount = 0, medianGap = null, targetComparison = null } = {}) {
  const notes = [];
  if (noteCount < 5) {
    notes.push('The note detector did not find enough clear notes to assess this passage. Try a shorter recording with the piano closer to the microphone and less background noise.');
  } else {
    notes.push('The note detector found ' + noteCount + ' note events. Check the generated notation against the recording before relying on the transcription.');
  }
  if (rms < 0.015) notes.push('The recording level is quiet; move the microphone closer or increase input gain slightly.');
  if (peak > 0.99 || clippedRatio > 0.01) notes.push('Some audio peaks are clipping; lower the input gain or move the microphone farther away.');
  if (medianGap !== null && Number.isFinite(medianGap) && medianGap < 0.16) notes.push('The detected onsets are closely spaced, so practise the passage slowly with a steady pulse.');
  if (medianGap !== null && Number.isFinite(medianGap) && medianGap > 1.2) notes.push('There are long gaps between detected onsets; check whether quiet notes or pauses were missed.');
  if (targetComparison?.total > 0) {
    notes.push('Automated target-note check: ' + targetComparison.correct + ' of ' + targetComparison.total + ' expected notes matched.');
  }
  notes.push('This is a pitch and timing estimate, not a reliable judgement of expression or complete chord accuracy.');
  return notes.join(' ');
}
