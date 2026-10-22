# Single-container deployment: frontend + Audiveris API on the same origin.
FROM node:22-bookworm-slim AS frontend
WORKDIR /site
COPY package.json ./
RUN npm install
COPY index.html ./
COPY src ./src
COPY public ./public
COPY vite.config.js ./
RUN npm run build

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl jq python3 python3-pip unzip \
    && rm -rf /var/lib/apt/lists/*

# Audiveris release package includes the runtime required by the CLI.
RUN set -eux; \
    url="$(curl -fsSL https://api.github.com/repos/Audiveris/audiveris/releases/latest | jq -r '.assets[] | select(.name | endswith(".deb")) | .browser_download_url' | head -n 1)"; \
    test -n "$url"; \
    curl -fL "$url" -o /tmp/audiveris.deb; \
    apt-get update; apt-get install -y /tmp/audiveris.deb || (apt-get install -f -y && apt-get install -y /tmp/audiveris.deb); \
    rm -f /tmp/audiveris.deb; rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir fastapi "uvicorn[standard]" python-multipart
WORKDIR /app
COPY omr-service/main.py /app/main.py
COPY --from=frontend /site/dist /app/dist
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
