import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response

app = FastAPI(title="Piano Coach Audiveris OMR", version="1.0.0")

# Set ALLOWED_ORIGINS to comma-separated site origins in production.
origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "*").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

MAX_BYTES = 25 * 1024 * 1024
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}

@app.get("/health")
def health():
    return {"ok": True, "engine": "Audiveris"}

@app.post("/api/recognize", response_class=PlainTextResponse)
async def recognize(file: UploadFile = File(...)):
    suffix = Path(file.filename or "score.png").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(415, "Upload a PDF, PNG, JPEG or WebP score.")
    payload = await file.read(MAX_BYTES + 1)
    if not payload:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(payload) > MAX_BYTES:
        raise HTTPException(413, "Choose a score smaller than 25 MB.")

    with tempfile.TemporaryDirectory(prefix="pianocoach-omr-") as tmp:
        root = Path(tmp)
        input_path = root / ("input" + suffix)
        output_dir = root / "out"
        output_dir.mkdir()
        input_path.write_bytes(payload)
        try:
            result = subprocess.run(
                ["audiveris", "-batch", "-export", "-output", str(output_dir), str(input_path)],
                capture_output=True, text=True, timeout=180, check=False,
                env={**os.environ, "HOME": str(root)},
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "Audiveris timed out after 180 seconds. Try a smaller score.")
        except FileNotFoundError:
            raise HTTPException(500, "Audiveris executable was not found in the service image.")

        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "Audiveris could not recognise this score.")[-1200:]
            raise HTTPException(422, detail)

        # Audiveris normally exports compressed MusicXML (.mxl). Unpack it for the browser app.
        candidates = list(output_dir.rglob("*.xml")) + list(output_dir.rglob("*.musicxml"))
        for archive in output_dir.rglob("*.mxl"):
            try:
                with zipfile.ZipFile(archive) as zf:
                    names = [n for n in zf.namelist() if n.lower().endswith((".xml", ".musicxml")) and not n.lower().endswith("container.xml")]
                    if names:
                        candidates.append((archive, names[0]))
                        break
            except zipfile.BadZipFile:
                continue

        for candidate in candidates:
            try:
                if isinstance(candidate, tuple):
                    with zipfile.ZipFile(candidate[0]) as zf:
                        xml = zf.read(candidate[1]).decode("utf-8-sig")
                else:
                    xml = candidate.read_text(encoding="utf-8-sig")
                if "<score-partwise" in xml or "<score-timewise" in xml:
                    return PlainTextResponse(xml, media_type="application/vnd.recordare.musicxml+xml")
            except (OSError, UnicodeDecodeError, zipfile.BadZipFile):
                continue
        raise HTTPException(422, "Audiveris finished but did not produce a readable MusicXML score.")

@app.get("/{asset_path:path}", include_in_schema=False)
def serve_site(asset_path: str):
    # Serve the built Vite frontend from the same origin as the OMR API.
    dist = Path("/app/dist").resolve()
    if not dist.is_dir():
        raise HTTPException(503, "The Piano Coach frontend build is missing.")
    requested = (dist / asset_path).resolve() if asset_path else dist / "index.html"
    if requested != dist and dist not in requested.parents:
        raise HTTPException(404, "Not found.")
    if requested.is_file():
        return FileResponse(requested)
    # SPA route fallback: let React handle browser routes.
    index = dist / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(404, "Not found.")
