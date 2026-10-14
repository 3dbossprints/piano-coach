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
