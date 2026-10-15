# Piano Coach

A mobile-friendly piano practice companion.

## Features
- Set a target grade and a 6-, 9-, or 12-month learning horizon
- Customise weekly practice frequency and session length
- Daily practice checklist and focus timer
- Local progress and practice reflections
- Experimental microphone-based single-note pitch estimation

## Run locally
Open `index.html` in a browser. Microphone access generally requires HTTPS or localhost.

## Deploy to Vercel
1. Import this repository at https://vercel.com/new
2. Keep the framework preset as **Other** (static site).
3. Leave the build command and output directory empty, or use the repository root as the output directory.
4. Deploy. Vercel will provide a public URL.

## Important limitations
This is an early prototype. The pitch detector is experimental and is not a full performance assessor: it does not yet compare a played piece with sheet music or reliably diagnose missed notes, timing, fingering, or exam readiness. Progress is stored in the current browser only; it is not synchronised between devices. Grade syllabuses vary by exam board, so confirm exam requirements with your chosen board and teacher.


## Local AI piano tutor (experimental)

The conversational tutor uses a quantized Llama 3.2 1B Instruct model through WebLLM and WebGPU in the browser. It does **not** use an OpenAI API key or send chat prompts to an AI inference API. The first use downloads model files (approximately 1 GB, depending on the selected build) from the model CDN; subsequent use may reuse the browser cache. A modern browser with WebGPU support and sufficient free memory is required. This can be slow or unavailable on older devices, phones with limited memory, or browsers without WebGPU.

The microphone's speech-to-text feature may use the browser's speech-recognition service, depending on the browser. Spoken replies use the browser's speech synthesis. The tutor is text-only with respect to piano playing: it does not yet analyse live performance audio or interpret uploaded score images.

The older optional **AI practice feedback** feature may still use the separate OpenAI-key workflow. That is separate from the local conversational tutor; you can leave its key field blank and use local note comparison without an API key.
