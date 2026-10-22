FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl jq python3 python3-pip unzip \
    && rm -rf /var/lib/apt/lists/*

# Use the official latest Linux .deb release; Audiveris packages include a Java runtime.
RUN set -eux; \
    url="$(curl -fsSL https://api.github.com/repos/Audiveris/audiveris/releases/latest | jq -r '.assets[] | select(.name | endswith(".deb")) | .browser_download_url' | head -n 1)"; \
    test -n "$url"; \
    curl -fL "$url" -o /tmp/audiveris.deb; \
    apt-get update; apt-get install -y /tmp/audiveris.deb || (apt-get install -f -y && apt-get install -y /tmp/audiveris.deb); \
    rm -f /tmp/audiveris.deb; rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir fastapi uvicorn python-multipart
WORKDIR /app
COPY main.py /app/main.py
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
