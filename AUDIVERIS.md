# Score recognition in the Vercel browser build

Piano Coach is configured to run as a static Vite site on Vercel. It does not call a Vercel Function or a separate recognition server when a score image is selected.

## What works without a backend

- Import and parse MusicXML files in the browser.
- View uploaded PDF/images and save them in the local library.
- Render imported MusicXML as sheet music.
- Use the app's other client-side practice features.

## Current limitation

Automatic transcription of a score image or PDF is **not available** in this browser-only build. Audiveris is a Java application and cannot be executed as normal browser JavaScript. Rather than silently sending uploads to an API, the recognition action explains the limitation and leaves the original file local.

To analyse notation, import a MusicXML file (.musicxml). If browser-only image-to-MusicXML transcription is added later, it must use a compatible client-side OMR engine; that is a different implementation from Audiveris and needs accuracy and performance testing.

No Dockerfile, Vercel Function, or external OMR service is required for the current static-site build.
