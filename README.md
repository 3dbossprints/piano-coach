# Piano Coach

A mobile-friendly piano practice companion.

## Features
- Set a target grade and a 6-, 9-, or 12-month learning horizon
- Customise weekly practice frequency, session length, target grade, and practice focus
- A short daily checklist and focus timer that follows your session goal
- Weekly practice-day/minute totals and a recent 14-day session history
- Progress, practice history, reflections, and uploaded scores saved locally with IndexedDB (localStorage fallback)
- An audible Web Audio mini keyboard plus experimental live spectral pitch-group estimation across A0–C8

## Run locally
Open `index.html` in a browser. Microphone access generally requires HTTPS or localhost.

## Deploy to Vercel
1. Import this repository at https://vercel.com/new
2. Keep the framework preset as **Other** (static site).
3. Leave the build command and output directory empty, or use the repository root as the output directory.
4. Deploy. Vercel will provide a public URL.

## Important limitations
This is an early prototype. The live pitch detector estimates multiple spectral peaks and groups them as chord-like events, then can compare those groups with an entered target sequence. It is still a spectrum-based prototype rather than a trained polyphonic transcription model; piano overtones may be mistaken for notes, and it does not reliably score timing, rhythm, fingering, dynamics, or exam readiness. Progress is stored in the current browser only; it is not synchronised between devices. Grade syllabuses vary by exam board, so confirm exam requirements with your chosen board and teacher.


## Local AI piano tutor (experimental)

The conversational tutor uses a quantized Llama 3.2 1B Instruct model through WebLLM and WebGPU in the browser. It does not use an OpenAI API key or send chat prompts to an AI inference API. The first use downloads model files (roughly 1 GB, depending on the model build) from the model CDN; subsequent use may reuse the browser cache. A modern browser with WebGPU support and sufficient free memory is required. This can be slow or unavailable on older devices or browsers without WebGPU.

The microphone's speech-to-text feature depends on browser support and may use a browser speech-recognition service. The tutor defaults to the Kokoro neural voice worker for spoken replies, with device speech as a fallback. The tutor is text-only with respect to piano playing: it does not yet analyse live performance audio or interpret uploaded score images.

The separate optional AI practice-feedback feature may still use an OpenAI-key workflow. Its offline note comparison works without a key.


## On-device tutor, speech and playing feedback

The conversational tutor uses a quantized Llama 3.2 1B model through WebLLM/WebGPU. It does not require an OpenAI key for chat. A compatible browser and GPU are required, and the first model download is large. The same generated answer is shown as text and spoken aloud using browser speech synthesis.

The speech controls let you choose the natural Kokoro neural voice or an installed browser/operating-system voice and adjust speed. The Kokoro speech model is downloaded on first use; actual audio playback depends on browser support and successful model loading. The tutor uses the same generated answer for text and speech.

For playing feedback, the tutor can use recent grouped pitch estimates and compare them with an expected sequence. MusicXML extraction keeps chord tones together when the file encodes them as simultaneous notes. The live detector is experimental and can confuse harmonics with real notes; it does not yet provide reliable full-piece alignment or score timing, dynamics, fingering, or tone quality.

PDF and image scores remain stored locally and are not automatically interpreted. MusicXML files can be parsed locally into a basic note sequence from the first part; chord tones and rests are skipped, so verify the extracted sequence before using it. Full optical music recognition for scanned pages and robust live piano audio transcription are not yet implemented.


## Sheet music search

The Sheet Music Library page previews results from the Internet Archive and Wikimedia Commons when their public search feeds are available in the browser. It also provides direct searches for IMSLP and Mutopia and licensed services such as Scribd, Musicnotes, and Sheet Music Plus. These services host their own content; check the edition, access terms, and copyright/licence for your location. Search previews may be unavailable if a service or browser blocks cross-origin requests.
