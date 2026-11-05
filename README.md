# Piano Coach

A local-first piano practice and sheet-music workspace.

## Features

- Practice sessions, target grades, weekly goals, history and reflections.
- A virtual piano keyboard with selectable starting note and 2–5 octave viewing range.
- Experimental microphone pitch tracking for played notes and practice feedback.
- Sheet Music collection for saved scores, PDFs, images, MusicXML and native `.musiccoach` files.
- On-device HOMR optical music recognition (OMR) for supported PDF and image scores. Recognition is best-effort; compare every result with the original.
- MusicXML/XML parsing into editable score data, score preview, and `.musiccoach` export.
- A composition canvas and notation tools for drafting notes, rests and common markings.
- A local music assistant that runs in the browser without an OpenAI API key.
- `.musicdata` export/import for backing up and restoring saved sessions, score files, composer state, preferences and grade-plan data.

## Local development

Use Node.js 20+:

```sh
npm install
npm run dev
```

The development start/build preparation downloads the HOMR source and three model checkpoints (about 157 MB total) into generated local assets. Later starts reuse those files. Open the Vite URL printed by the terminal. Browser-based OMR currently relies on WebAssembly JSPI support; use a current Chrome or Edge release (137+).

## Deploy to Vercel

1. Import this repository at https://vercel.com/new.
2. Keep the repository root as the project root.
3. Use `npm install` for installation and `npm run build` as the build command. The output directory is `dist`; `vercel.json` sets these automatically.
4. The build downloads the OMR engine and model assets and includes them as static files. Recognition runs on the device; no separate recognition server is used.

The first OMR run downloads roughly 157 MB of model files to the browser cache. Multi-page PDFs can take time and require memory. Keep the original score and review all converted notation before practising or exporting.

## Local music assistant

The assistant uses Transformers.js with a quantized Llama 3.2 1B Instruct model in the browser. It tries WebGPU when available and has a compatible WASM fallback. It does not need an OpenAI API key for chat. Model weights download on first use and may require substantial memory; on constrained devices the model can fail to load or run.

## Important limitations

This is an evolving application. OMR may misread noteheads, pitches, accidentals, rhythm, rests, ties, multiple voices or technical markings—especially in low-quality photographs and complex engraving. Recognition confidence is not a guarantee of correctness. Use the original and generated score side by side, correct errors, and keep backups.

The live microphone detector is experimental: piano overtones may be mistaken for notes and it does not reliably provide full-piece alignment, rhythm scoring, fingering or exam readiness. MusicXML is structurally parsed, but unusual or unsupported notation should still be reviewed.

Practice data is stored in the current browser and is not automatically synchronised between devices. Use the download/upload arrows in the sidebar to export and restore a `.musicdata` backup. Store that backup somewhere outside the browser; clearing site data does not delete an independently saved backup.

## Sheet-music search

The Sheet Music page combines your own saved-score collection with external catalogue/search links. External services host their own content; check the edition, access terms and copyright/licence for your location. Search previews may be unavailable if a service or browser blocks cross-origin requests.
