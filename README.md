# NullShare — Secure File Sharing System
**by NullGrids | Built by Raihaan Syed (Nullfist)**

A production-grade, cybersecurity-focused file sharing system. Share folders securely with token-based access, password protection, IP whitelisting, real-time audit logs, and Cloudflare Tunnel support for instant public HTTPS links — no port forwarding required.

---

## 🏗️ Project Structure

```
nullshare/
├── backend/
│   ├── server.js              # Express app entry point
│   ├── package.json           # Dependencies
│   ├── .env.example           # Environment config template
│   ├── .env                   # Auto-generated on startup
│   ├── db/
│   │   └── database.js        # SQLite schema + query helpers
│   ├── routes/
│   │   ├── shares.js          # Share CRUD (sharer-facing API)
│   │   └── access.js          # File access (receiver-facing API)
│   ├── middleware/
│   │   └── auth.js            # JWT validation middleware
│   └── utils/
│       ├── security.js        # Tokens, path sandboxing, IP checks
│       ├── fileSystem.js      # Directory listing, file streaming
│       ├── encryption.js      # AES-256-GCM stream encryption
│       ├── malwareScan.js     # ClamAV integration
│       ├── virusTotal.js      # VirusTotal API fallback
│       ├── ipReputation.js    # AbuseIPDB + geo enrichment
│       ├── logBroadcaster.js  # WebSocket log streaming
│       ├── s3Storage.js       # S3 / MinIO backend
│       └── signedUrl.js       # Time-limited download URLs
├── frontend/
│   ├── sharer/
│   │   └── index.html         # Sharer dashboard
│   └── receiver/
│       └── index.html         # Receiver file browser
├── deploy/
│   ├── nginx.conf             # Nginx reverse proxy config
│   ├── setup-tls-windows.bat  # mkcert TLS setup (Windows)
│   └── setup-tls.sh           # mkcert TLS setup (Linux/Mac)
├── Dockerfile
├── docker-compose.yml
├── start.bat                  # Windows launcher (auto-generates JWT + tunnel)
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 16+ — [download](https://nodejs.org/)
- **cloudflared** at `C:\cloudflared\cloudflared.exe` — [download](https://github.com/cloudflare/cloudflared/releases/latest)
  - Rename downloaded file to `cloudflared.exe` and place in `C:\cloudflared\`

### Launch
```bash
# Windows: Double-click start.bat
start.bat
```

`start.bat` automatically:
1. Runs `npm install` if needed
2. Creates `.env` from template if missing
3. Generates a fresh `JWT_SECRET` (64-byte random hex)
4. Starts Cloudflare Tunnel in a separate window
5. Waits for the tunnel URL, then updates `PUBLIC_URL` and `ALLOWED_ORIGINS` in `.env`
6. Starts the server on `http://localhost:3000`

Output:
```
==========================================
  Dashboard : http://localhost:3000
  Public    : https://xyz.trycloudflare.com
  Share via : https://xyz.trycloudflare.com/share/TOKEN
==========================================
```

---

## 🌐 Cloudflare Tunnel

NullShare uses [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose your local server publicly over HTTPS — no port forwarding, no static IP, no router config.

```
Receiver's browser
      ↓ HTTPS
Cloudflare Edge (public URL)
      ↓ encrypted tunnel
cloudflared.exe (running on your PC)
      ↓ localhost
NullShare on :3000
```

### Setup
1. Download `cloudflared-windows-amd64.exe` from [GitHub releases](https://github.com/cloudflare/cloudflared/releases/latest)
2. Rename to `cloudflared.exe`
3. Place at `C:\cloudflared\cloudflared.exe`
4. Run `start.bat` — tunnel starts automatically

### Quick tunnel (no account needed)
The default setup uses **Cloudflare Quick Tunnels** — free, no login required. The URL changes every time you restart.

### Named tunnel (permanent URL)
For a stable URL that never changes:
```bash
cloudflared login
cloudflared tunnel create nullshare
cloudflared tunnel route dns nullshare nullshare.yourdomain.com
```
Then update `start.bat` to use `cloudflared tunnel run nullshare` instead.

---

## 📡 API Reference

### Share Management (Sharer)

#### POST `/api/shares` — Create a new share
```json
{
  "folderPath": "C:\\Users\\you\\Documents\\MyProject",
  "label": "Project Files",
  "permission": "download",
  "expiresInMinutes": 1440,
  "password": "s3cret",
  "allowedIPs": ["192.168.1.10"],
  "scanBeforeShare": true
}
```

#### GET `/api/shares` — List all shares
#### DELETE `/api/shares/:id` — Revoke a share
#### GET `/api/shares/:id/logs` — Logs for a specific share
#### GET `/api/shares/logs/all` — All logs (dashboard)
#### GET `/api/shares/logs/export` — Export logs as CSV (with geo data)
#### POST `/api/shares/:id/scan` — Scan share for malware
#### POST `/api/shares/:id/signed-url` — Generate a signed direct download URL

---

### File Access (Receiver)

#### GET `/api/access/:token/info` — Share info (public, no auth)
#### POST `/api/access/:token/auth` — Authenticate with password → returns session JWT
#### GET `/api/access/:token/files?path=` — Browse directory
#### GET `/api/access/:token/download?path=` — Download a file
#### GET `/api/access/:token/preview?path=` — Preview a file inline
#### GET `/api/access/:token/zip?path=` — Download a folder as ZIP archive
#### GET `/api/access/:token/ip-info` — Caller's IP geo + reputation info

---

### Signed Direct Download

#### GET `/dl?shareId=X&path=Y&exp=T&sig=HMAC` — Time-limited direct download
No Bearer token needed — the URL itself is the credential. Generate via `POST /api/shares/:id/signed-url`.

---

## 📁 Folder Download (ZIP)

Receivers with **download** permission can download any folder as a ZIP archive:

- **Per-folder button** — hover over any directory row → click `⬇ ZIP`
- **Toolbar button** — "Download Folder as ZIP" appears above the file list for the current directory
- ZIP is streamed on-the-fly (no temp files on server)
- Progress toast shows bytes received
- Logged as `download_zip` action in access logs

---

## 🔐 Security Architecture

### Path Sandboxing
Every file/folder request goes through `safePath()`:
- Resolves full absolute path
- Verifies it starts with the share root
- Blocks URL encoding, double encoding, null bytes, symlinks

### Authentication Flow
```
Receiver → GET /info       → is password needed?
         → POST /auth      → bcrypt verify → JWT issued
         → All requests    → Bearer JWT required
         → JWT carries     → permission level, share_id, expiry
```

### Rate Limiting
- `/auth` — 10 attempts per 15 minutes (brute-force protection)
- File access — 120 req/min per session
- Global — 300 req/min per IP

### Access Logging
Every action logged:
```
share_id | ip_address | user_agent | action | file_path | status | timestamp
```

Actions: `auth_success`, `auth_fail`, `view_index`, `view_file`, `download`, `download_zip`, `traversal_attempt`, `expired_access`

### Link Security
- **Tokens** — 256-bit cryptographically random (base64url)
- **Passwords** — bcrypt cost factor 12
- **Expiry** — hard-enforced server-side
- **IP Whitelist** — checked on every request
- **Revocation** — instant via dashboard

### CORS & CSP
- Automatically allows `*.trycloudflare.com` origins — no manual config needed
- `PUBLIC_URL` and `ALLOWED_ORIGINS` auto-updated by `start.bat` on each launch
- Dynamic CSP `connect-src` includes tunnel origin at runtime

---

## 🔧 Configuration

### Environment Variables (`.env`)
```env
# Server
PORT=3000
NODE_ENV=development
PUBLIC_URL=https://xyz.trycloudflare.com   # auto-set by start.bat

# JWT
JWT_SECRET=<auto-generated-64-byte-hex>    # regenerated every launch

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://xyz.trycloudflare.com

# TLS (optional — run deploy/setup-tls-windows.bat first)
TLS_ENABLED=false
TLS_CERT=./certs/nullshare.pem
TLS_KEY=./certs/nullshare-key.pem

# S3 Storage (optional)
S3_ENABLED=false
S3_BUCKET=nullshare
S3_REGION=us-east-1
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_ENDPOINT=
S3_PATH_STYLE=false

# End-to-End Encryption (optional — HTTPS only)
ENCRYPTION_ENABLED=false
ENCRYPTION_SECRET=

# Malware Scanning (optional)
VIRUSTOTAL_KEY=       # https://www.virustotal.com (free: 500 req/day)
ABUSEIPDB_KEY=        # https://www.abuseipdb.com (free: 1000 req/day)
```

### Database Schema
```sql
CREATE TABLE shares (
  id           TEXT PRIMARY KEY,
  token        TEXT UNIQUE NOT NULL,
  folder_path  TEXT NOT NULL,
  label        TEXT,
  password_hash TEXT,
  permission   TEXT NOT NULL DEFAULT 'view',
  expires_at   INTEGER,
  ip_whitelist TEXT,
  created_at   INTEGER NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE access_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id    TEXT NOT NULL,
  ip_address  TEXT NOT NULL,
  user_agent  TEXT,
  action      TEXT NOT NULL,
  file_path   TEXT,
  status      TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  FOREIGN KEY (share_id) REFERENCES shares(id)
);
```

---

## 🐳 Docker

```bash
docker-compose up -d
```

Or manually:
```bash
docker build -t nullshare .
docker run -p 3000:3000 -v ./backend/data:/app/data nullshare
```

---

## 🧪 Testing

### Directory traversal
```bash
curl "http://localhost:3000/api/access/TOKEN/files?path=../../etc" \
  -H "Authorization: Bearer SESSION_JWT"
# → 403
```

### Brute force protection
```bash
for i in {1..11}; do
  curl -s -X POST http://localhost:3000/api/access/TOKEN/auth \
    -H "Content-Type: application/json" \
    -d '{"password":"wrong"}' | jq .error
done
# → 429 after 10 attempts
```

### Folder ZIP download
```bash
curl "http://localhost:3000/api/access/TOKEN/zip?path=subfolder" \
  -H "Authorization: Bearer SESSION_JWT" \
  -o subfolder.zip
```

---

## 🐛 Troubleshooting

### "Cross-origin request blocked"
`start.bat` auto-fixes this by updating `ALLOWED_ORIGINS` and `PUBLIC_URL` with the tunnel URL. If it persists, restart `start.bat` — a new tunnel URL is generated and `.env` is updated before the server starts.

### "Cannot find module 'express'"
```bash
cd backend && npm install
```

### "Port 3000 already in use"
```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### "Tunnel URL not detected"
Check `%TEMP%\nullshare_tunnel.log` for cloudflared output. Make sure `C:\cloudflared\cloudflared.exe` exists.

### "Database locked"
```bash
del backend\data\nullshare.db-shm backend\data\nullshare.db-wal
```

### "Rate limit exceeded"
Wait 15 minutes or restart the server (in-memory rate limiter resets on restart).

---

## 📈 Phase Roadmap

### ✅ Phase 1 — MVP
- Folder select + share creation
- Token-based access, file browser UI, file download

### ✅ Phase 2 — Security
- JWT auth, bcrypt passwords, path sandboxing
- Rate limiting, IP whitelisting, access logging, link expiry

### ✅ Phase 3 — Optimization
- QR code generation
- Chunked download with progress toasts
- PDF preview (iframe + pdf.js fallback)
- Folder download as ZIP (streamed, no temp files)

### ✅ Phase 4 — Advanced
- Real-time WebSocket log streaming
- ClamAV + VirusTotal malware scanning
- AES-256-GCM end-to-end encryption
- Signed time-limited download URLs
- IP geolocation + AbuseIPDB reputation
- CSV log export with geo data
- S3 / MinIO storage backend
- Docker containerization
- TLS / HTTPS (mkcert for local, nginx + certbot for prod)
- **Cloudflare Tunnel** — instant public HTTPS, zero config

---

## 🔒 Production Hardening Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Put behind nginx with TLS (see `deploy/nginx.conf`)
- [ ] Restrict dashboard (`/`) to localhost only via nginx auth
- [ ] Set `PUBLIC_URL` to your actual domain
- [ ] Enable `ENCRYPTION_ENABLED=true` (HTTPS required)
- [ ] Add `VIRUSTOTAL_KEY` and `ABUSEIPDB_KEY`
- [ ] Use named Cloudflare Tunnel for stable URL
- [ ] Set up monitoring and alerting
- [ ] Regular dependency updates (`npm audit`)

### Nginx Config
```nginx
server {
    listen 443 ssl http2;
    server_name nullshare.example.com;

    ssl_certificate /etc/letsencrypt/live/nullshare.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nullshare.example.com/privkey.pem;

    location / {
        auth_basic "NullShare Admin";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://localhost:3000;
    }

    location /api/access {
        proxy_pass http://localhost:3000;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 🛡️ Known Limitations

1. **Tunnel URL changes on restart** — use a named Cloudflare Tunnel for a permanent URL
2. **Dashboard has no login** — expose only on localhost or behind nginx auth
3. **Symlinks skipped** — security trade-off
4. **SQLite only** — use PostgreSQL for production scale
5. **ZIP of very large folders** — streamed but memory-intensive for millions of files

---

## 📞 Support

- **Email:** nullfist@nullgrids.com
- **Twitter:** @nullfist
- **Discord:** NullGrids Community

---

**Built with ❤️ by Raihaan Syed (Nullfist) | NullGrids Security | 2025**
