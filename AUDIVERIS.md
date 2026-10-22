# Audiveris OMR integration

Piano Coach now routes score-image recognition through Audiveris instead of the old single-treble-staff notehead heuristic. Audiveris is a separate Java application, so it must run as a server-side service; it is not bundled into the browser app.

## Frontend configuration

Set this Vite build-time environment variable to the public HTTPS URL of your Audiveris adapter, then rebuild/redeploy the site:

```env
VITE_AUDIVERIS_API_URL=https://YOUR-OMR-SERVICE.example/api/recognize
```

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

**Important:** The frontend and deployable service code are committed, but I cannot deploy the service or set your hosting environment variables from this repository edit. Until you deploy `omr-service/` and configure `VITE_AUDIVERIS_API_URL`, image/PDF recognition will show a setup error. MusicXML import continues to work without the service.
