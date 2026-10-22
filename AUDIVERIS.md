# Audiveris OMR integration

Piano Coach now routes score-image recognition through Audiveris instead of the old single-treble-staff notehead heuristic. Audiveris is a separate Java application, so it must run as a server-side service; it is not bundled into the browser app.

## Run it as part of the website (same origin)

The repository root now has a `Dockerfile` that builds the Vite frontend and runs the Audiveris API in the same container. Deploy the repository as a Docker web service and point the website domain at that service. The browser calls `/api/recognize` on the same domain by default, so there is no separate OMR URL or CORS configuration to set. The service code lives in `omr-service/`.

This requires a host that supports Docker containers and enough memory/CPU for Audiveris. A static-only deployment (for example, a plain Vite static site) cannot execute the Java-based Audiveris engine in the browser; deploy the root Dockerfile to enable the integrated API.

For an existing separate OMR host only, you can optionally set `VITE_AUDIVERIS_API_URL` to its full HTTPS `/api/recognize` URL and rebuild.

The browser sends the original PDF/PNG/JPEG/WebP file as a multipart/form-data field named `file`. The service must allow CORS from the Piano Coach site and return **uncompressed MusicXML XML text** (`application/vnd.recordare.musicxml+xml`, `application/xml` or `text/xml`). A JSON response shaped as `{"musicxml":"<score-partwise>...</score-partwise>"}` is also accepted. Do not return the zipped `.mxl` file unless your adapter unpacks it first.

## Included service

A Docker-based FastAPI adapter is included in `omr-service/`. It installs the official Audiveris Linux release, accepts PDF/PNG/JPEG/WebP uploads, runs batch transcription, unpacks MusicXML when Audiveris exports `.mxl`, and returns uncompressed XML. See `omr-service/README.md` for deployment steps.

## Audiveris adapter contract

The service should:
1. Accept a single uploaded file in `file`.
2. Validate file type and size, and process it in a temporary directory with a strict timeout and cleanup.
3. Run Audiveris in batch mode and export MusicXML (Audiveris CLI supports `-batch -export -output OUTPUT INPUT`).
4. Locate the generated `.xml` file (or unpack the generated `.mxl`) and return the XML content.
5. Return useful HTTP error messages for invalid or unreadable scores.

Audiveris supports printed Common Western Music Notation, including multi-page scores, but not handwritten notation; its own documentation warns that recognition is not perfect. Users should review the resulting transcription before practising.

Official references:
- https://github.com/Audiveris/audiveris
- https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/

**Important:** The integrated Docker deployment is committed, but I have not deployed it to your live hosting provider or verified a production conversion. If the current live site is still deployed as static files, its image/PDF recognition will not work until the site is redeployed using the root Dockerfile. MusicXML import continues to work.
