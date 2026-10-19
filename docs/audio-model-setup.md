# Local audio analysis

Piano Coach analyses recordings in the browser. The recording is not uploaded to a Piano Coach server or sent to a cloud audio model.

## How it works

- The browser downloads the Basic Pitch model assets and runs polyphonic note transcription locally with Web Audio.
- The app derives onset spacing, note durations, pitch range, waveform level and clipping measurements from the recording locally.
- When available, the browser-local text tutor turns those measured observations into practice suggestions. It receives text evidence, not the raw audio.
- A song catalogue preview may be fetched separately when the learner asks to compare against a named song. That is reference audio, not the learner's recording.

## Important limits

This is local audio analysis, not a trained piano-performance judge. Pitch transcription and waveform measurements can help identify note patterns, timing and recording-level issues, but they cannot reliably infer touch, tone quality, dynamics, pedalling, or musical expression. A comparison against a short catalogue preview is approximate and should not be treated as a full-song grade.

No server-side API key is required for the learner's recording analysis. The first run needs an internet connection to download the model code/assets; after caching, availability depends on the browser cache and model hosting.