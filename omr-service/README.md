# Piano Coach Audiveris OMR service

This Docker service runs the official Audiveris command-line recogniser and returns MusicXML for Piano Coach.

## Deploy

Deploy this folder (`omr-service/`) as a Docker web service on a host that supports custom containers. The Dockerfile installs the latest official Audiveris Linux .deb release at build time.

Set `ALLOWED_ORIGINS` to the exact origin of the Piano Coach site, for example `https://your-site.example`. The service exposes `GET /health` and `POST /api/recognize`.

Then configure the frontend build variable:
```env
VITE_AUDIVERIS_API_URL=https://YOUR-OMR-SERVICE.example/api/recognize
```
Rebuild and redeploy the frontend after setting it.

Uploads are limited to 25 MB and processing to 180 seconds. Files are processed in a temporary directory and removed when each request ends. Printed Common Western notation is supported; handwritten scores are not. Recognition is not perfect, so review the returned score before practising.

Restrict CORS with `ALLOWED_ORIGINS` in production. OMR can be CPU- and memory-intensive; choose a host with enough RAM and configure its request timeout accordingly.
