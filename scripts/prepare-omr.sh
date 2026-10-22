#!/usr/bin/env bash
# Build-time preparation for local, browser-only HOMR OMR. No server functions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HOMR_COMMIT=863eb3c6487f3c6fe50267fb71613f05162bb7c5
BASE_URL=https://github.com/liebharc/homr/releases/download/onnx_checkpoints
MODELS=(
  segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f
  encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6
  decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6
)
mkdir -p vendor public/vendor public/models public/omr
cp omr/runner.py public/omr/runner.py
cp omr/onnxruntime.py public/omr/onnxruntime.py
cp OMR-LICENSES.md public/omr/THIRD-PARTY-NOTICES.txt
if [ ! -d vendor/homr-src/.git ]; then
  git init -q vendor/homr-src
  git -C vendor/homr-src remote add origin https://github.com/liebharc/homr.git
fi
git -C vendor/homr-src fetch -q --depth 1 origin "$HOMR_COMMIT"
git -C vendor/homr-src checkout -q FETCH_HEAD
rm -f vendor/homr.zip
(cd vendor/homr-src && zip -qr ../homr.zip homr LICENSE -x '*.onnx' '*__pycache__*' '*coreml_cache*')
cp vendor/homr.zip public/vendor/homr.zip
cp vendor/homr-src/LICENSE public/vendor/HOMR-LICENSE
for m in "${MODELS[@]}"; do
  if [ ! -f "public/models/$m.onnx" ]; then
    echo "Downloading OMR model $m"
    curl -fL --retry 4 --retry-delay 2 -o "models-$m.zip" "$BASE_URL/$m.zip"
    unzip -o -q -j "models-$m.zip" '*.onnx' -d public/models
    rm "models-$m.zip"
  fi
done
cp public/vendor/HOMR-LICENSE public/omr/HOMR-LICENSE
echo "Prepared HOMR source and model files for browser OMR."
du -sh public/models public/vendor/homr.zip
