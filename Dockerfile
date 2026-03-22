FROM node:20-alpine

# Install ClamAV for malware scanning (optional — fails open if not running)
RUN apk add --no-cache clamav clamav-daemon freshclam tini && \
    mkdir -p /run/clamav && chown clamav:clamav /run/clamav

WORKDIR /app

# Copy package files first for layer caching
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Copy frontend (served as static files)
COPY frontend/ ../frontend/

# Create data directory for SQLite + certs
RUN mkdir -p ./data ./certs

# Update ClamAV definitions at build time (best-effort — may fail in air-gapped envs)
RUN freshclam --quiet || true

EXPOSE 3000

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start ClamAV daemon then Node server
CMD sh -c "clamd & node server.js"
