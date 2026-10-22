Third-party notices for Piano Coach's browser-only optical music recognition engine

HOMR
- Project: https://github.com/liebharc/homr
- Copyright and licence: HOMR is licensed under GNU Affero General Public License v3.0 (AGPL-3.0).
- The pinned HOMR source archive is provided at ../vendor/homr.zip and its licence at HOMR-LICENSE.

Partsong browser integration
- Project: https://github.com/pzfreo/partsong
- Copyright: Paul Fremantle.
- The browser worker and Pyodide/ONNX bridge in this project are adapted from Partsong and are licensed under AGPL-3.0-or-later.
- The corresponding source files are served as /omr-worker.js, /omr/runner.py and /omr/onnxruntime.py; the upstream source and licence are linked above.

Model and runtime components
- HOMR model checkpoints are distributed by the HOMR project. Their model lineage includes oemer (MIT) and Polyphonic-TrOMR (Apache-2.0); consult the upstream HOMR repository for detailed notices and model provenance.
- Pyodide: MPL-2.0; NumPy: BSD; OpenCV: Apache-2.0; Pillow: MIT-CMU; ONNX Runtime Web: MIT; pdf.js: Apache-2.0.
- Runtime JS/WASM packages are loaded from their upstream CDN URLs by the browser worker.

This recognition runs locally in the user's browser. Score images are not uploaded to a Piano Coach recognition server.
