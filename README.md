# NullShare — Secure File Sharing System

<div align="center">

![NullShare Banner](https://img.shields.io/badge/NULLSHARE-v2.0-0077B6?style=for-the-badge&logo=shield&logoColor=white)

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![JWT](https://img.shields.io/badge/Auth-JWT_%2B_bcrypt-FB015B?style=flat-square&logo=jsonwebtokens&logoColor=white)](https://jwt.io/)
[![AES-256](https://img.shields.io/badge/Encryption-AES--256--GCM-6B21A8?style=flat-square&logo=gnuprivacyguard&logoColor=white)]()
[![Docker](https://img.shields.io/badge/Docker-Supported-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![Cloudflare Tunnel](https://img.shields.io/badge/Cloudflare-Tunnel_Ready-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
[![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)](./LICENSE)

**by [NullGrids](mailto:nullfist@nullgrids.com) · Built by Raihaan Syed (Nullfist)**

*A production-grade, cybersecurity-first file sharing system. Share folders securely with JWT authentication, path sandboxing, bcrypt passwords, IP whitelisting, real-time audit logs, AES-256-GCM encryption, and Cloudflare Tunnel support for instant public HTTPS — no port forwarding required.*

[Quick Start](#-quick-start) · [Security Architecture](#-security-architecture) · [API Reference](#-api-reference) · [Docker](#-docker) · [Testing](#-testing)

</div>

---

## 📸 Screenshots

> **Sharer Dashboard** — Create shares, generate QR codes, scan for malware, monitor live access logs.

<img width="1919" height="855" alt="image" src="https://github.com/user-attachments/assets/f4cf564c-f592-45ec-9684-dc996759e039" />



> **Receiver File Browser** — Authenticate, browse folders, preview files, download with real-time progress.

<img width="1918" height="871" alt="image" src="https://github.com/user-attachments/assets/a0e3d124-1460-4736-be8b-99fa45cb5409" />
<img width="1919" height="854" alt="image" src="https://github.com/user-attachments/assets/cbfa0a48-968a-49aa-ad99-f521f277a951" />
<img width="1919" height="1024" alt="image" src="https://github.com/user-attachments/assets/8e9adc6e-b03b-4465-a0e4-8f7d6a65de91" />


> **Live Access Logs** — Real-time WebSocket feed showing every access event: IP, action, file path, status.

<img width="1919" height="878" alt="image" src="https://github.com/user-attachments/assets/e2c2d0fe-09c2-433f-8f9b-27cadd18c65d" />


> 💡 **No screenshots yet?** Run the project, take a screenshot of each view, and place them in `docs/screenshots/`. GitHub renders them automatically.

---

## ✨ Feature Highlights

| Feature | Details |
|---|---|
| 🔐 **JWT Authentication** | Two-token system — public share token + short-lived session JWT |
| 🛡️ **Path Sandboxing** | `safePath()` blocks all directory traversal variants at the OS level |
| 🔒 **bcrypt Passwords** | Cost factor 12 — ~250ms per check, brute force impractical |
| 🌐 **Cloudflare Tunnel** | Instant public HTTPS URL, zero config, no port forwarding |
| 📡 **Live Log Feed** | WebSocket push — see every access event in real time |
| 🦠 **Malware Scanning** | ClamAV + VirusTotal API fallback before sharing |
| 🔑 **Signed URLs** | HMAC-SHA256 time-limited direct download links |
| 🔐 **E2E Encryption** | AES-256-GCM stream encryption (optional, HTTPS required) |
| 📦 **Folder ZIP** | Download entire folders as streamed ZIP archives |
| 🌍 **IP Reputation** | AbuseIPDB + geolocation on every auth attempt |
| 🐳 **Docker Ready** | Single `docker-compose up -d` deployment |
| ☁️ **S3 / MinIO** | Optional object storage backend |

---

## 🏗️ Project Structure

```
nullshare/
├── backend/
│   ├── server.js              # Express app entry point
│   ├── package.json           # Dependencies
│   ├── .env.example           # Environment config template  ← copy this to .env
│   ├── db/
│   │   └── database.js        # SQLite schema + query helpers + WS broadcast hook
│   ├── routes/
│   │   ├── shares.js          # Share CRUD (sharer-facing API)
│   │   └── access.js          # File access (receiver-facing API)
│   ├── middleware/
│   │   └── auth.js            # JWT validation + download permission gate
│   └── utils/
│       ├── security.js        # Tokens, path sandboxing, IP checks
│       ├── fileSystem.js      # Directory listing, Range-aware streaming
│       ├── encryption.js      # AES-256-GCM stream encryption
│       ├── malwareScan.js     # ClamAV integration (fail-open)
│       ├── virusTotal.js      # VirusTotal API fallback scanner
│       ├── ipReputation.js    # AbuseIPDB + geo enrichment
│       ├── logBroadcaster.js  # WebSocket server + broadcast()
│       ├── s3Storage.js       # S3 / MinIO storage backend
│       └── signedUrl.js       # HMAC-SHA256 signed download URLs
├── frontend/
│   ├── sharer/index.html      # Dashboard: create, manage, live logs, QR, scan
│   └── receiver/index.html    # File browser: auth, browse, preview, progress DL
├── deploy/
│   ├── nginx.conf             # Production Nginx config (TLS, ACL, WS proxy)
│   ├── setup-tls-windows.bat  # mkcert TLS setup (Windows)
│   └── setup-tls.sh           # mkcert TLS setup (Linux/macOS)
├── Dockerfile
├── docker-compose.yml
├── start.bat                  # Windows one-click launcher (JWT + tunnel auto-setup)
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ — [download](https://nodejs.org/)
- **cloudflared** (for public HTTPS) — [download](https://github.com/cloudflare/cloudflared/releases/latest)
  - Rename the downloaded file to `cloudflared.exe` and place at `C:\cloudflared\cloudflared.exe`

### Windows (One Click)

```bat
start.bat
```

`start.bat` automatically handles everything:

1. Runs `npm install` if `node_modules` is missing
2. Creates `.env` from `.env.example` if not present
3. Generates a fresh `JWT_SECRET` (64-byte cryptographically random hex)
4. Starts Cloudflare Tunnel in a separate window
5. Detects the tunnel URL and patches `PUBLIC_URL` + `ALLOWED_ORIGINS` in `.env`
6. Starts the server on `http://localhost:3000`

```
==========================================
  Dashboard : http://localhost:3000
  Public    : https://xyz.trycloudflare.com
  Share via : https://xyz.trycloudflare.com/share/TOKEN
==========================================
```

### Linux / macOS (Manual)

```bash
cd backend
npm install
cp .env.example .env

# Generate a strong JWT secret and paste it into .env as JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

npm start
# Open http://localhost:3000
```

> ⚠️ **Important:** Never commit your `.env` file. It is listed in `.gitignore` by default. Only `.env.example` (with placeholder values) should be in version control.

---

## 🌐 Cloudflare Tunnel

NullShare uses [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose your local server publicly over HTTPS — no port forwarding, no static IP, no router configuration needed.

```
Receiver's browser
      ↓  HTTPS
Cloudflare Edge  (public URL — xyz.trycloudflare.com)
      ↓  encrypted tunnel
cloudflared.exe  (running on your PC)
      ↓  localhost
NullShare on :3000
```

### Setup

1. Download `cloudflared-windows-amd64.exe` from [GitHub Releases](https://github.com/cloudflare/cloudflared/releases/latest)
2. Rename to `cloudflared.exe` and place at `C:\cloudflared\cloudflared.exe`
3. Run `start.bat` — the tunnel starts automatically

### Quick Tunnel (No Account)

The default uses **Cloudflare Quick Tunnels** — free, no login required. The URL changes every restart.

### Named Tunnel (Permanent URL)

For a stable URL that never changes:

```bash
cloudflared login
cloudflared tunnel create nullshare
cloudflared tunnel route dns nullshare nullshare.yourdomain.com
```

Then update `start.bat` to use `cloudflared tunnel run nullshare`.

---

## 🔐 Security Architecture

### Path Sandboxing — Traversal Prevention

Every single file request goes through `safePath()` before touching the filesystem:

```
Attack → safePath() → Blocked
─────────────────────────────────────────────────────
../../etc/passwd          → path.resolve normalises → /etc → fails startsWith → 403
%2e%2e%2fetc%2fpasswd     → decodeURIComponent first → ../../etc → same → 403
..%252f (double-encoded)  → decoded once to ..%2f → literal → 403
file\0.txt                → null byte check fires immediately → 403
/etc/passwd (absolute)    → path.resolve(root, "/etc") fails startsWith → 403
symlink to /etc           → entry.isSymbolicLink() → skipped entirely → never listed
```

### Authentication Flow

```
Receiver → GET  /api/access/:token/info   → is password needed? (public)
         → POST /api/access/:token/auth   → bcrypt verify + IP check → JWT issued
         → GET  /api/access/:token/files  → Bearer JWT required
         → JWT carries                    → shareId + permission + expiry
         → Share revoked                  → JWT rejected on next request
```

### Security Layers Summary

| Layer | Implementation | What It Stops |
|---|---|---|
| Path sandbox | `safePath()` — resolve + startsWith | Directory traversal (all variants) |
| Auth tokens | 256-bit `crypto.randomBytes(32)` | Token enumeration / brute force |
| Session JWTs | HS256 + 64-byte secret | Token forgery / tampering |
| Password hashing | bcrypt cost 12 (~250ms) | Offline cracking |
| Rate limiting | 10 auth attempts / 15 min / IP | Online brute force |
| Signed URLs | HMAC-SHA256 + `timingSafeEqual` | URL forgery + timing oracle |
| E2E encryption | AES-256-GCM stream | MITM file interception |
| IP whitelist | Checked before password | Unauthorised networks |
| Access logging | Every event → SQLite + WS feed | Blind spot / no audit trail |

### Access Log Events

```
auth_success  · auth_fail  · view_index  · view_file  · download
download_zip  · traversal_attempt  · expired_access
```

Each row captures: `share_id · ip_address · user_agent · action · file_path · status · timestamp`

---

## 📡 API Reference

### Share Management — `/api/shares` (Sharer Only)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/shares` | Create a new share |
| `GET` | `/api/shares` | List all shares |
| `DELETE` | `/api/shares/:id` | Revoke a share immediately |
| `GET` | `/api/shares/:id/logs` | Logs for a specific share |
| `GET` | `/api/shares/logs/all` | All logs (dashboard view) |
| `GET` | `/api/shares/logs/export` | Export logs as CSV with geo data |
| `POST` | `/api/shares/:id/scan` | Trigger malware scan on share folder |
| `POST` | `/api/shares/:id/signed-url` | Generate a signed direct download URL |

**POST `/api/shares` — Request Body:**

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

### File Access — `/api/access` (Receiver-Facing)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/access/:token/info` | None (public) | Share info — label, passwordProtected, expiresAt |
| `POST` | `/api/access/:token/auth` | None (rate-limited) | Authenticate → returns session JWT |
| `GET` | `/api/access/:token/files?path=` | Bearer JWT | Browse a directory |
| `GET` | `/api/access/:token/download?path=` | Bearer JWT + download perm | Stream a file (Range supported) |
| `GET` | `/api/access/:token/preview?path=` | Bearer JWT | Inline file preview |
| `GET` | `/api/access/:token/zip?path=` | Bearer JWT + download perm | Download folder as ZIP (streamed) |
| `GET` | `/api/access/:token/ip-info` | Bearer JWT | Caller's IP geo + reputation |
| `GET` | `/dl?shareId=&path=&exp=&sig=` | Signed URL | Direct download — no JWT needed |

---

## 📁 Folder ZIP Download

Receivers with **download** permission can download any folder as a ZIP archive:

- **Per-folder button** — hover any directory row → click `⬇ ZIP`
- **Toolbar button** — "Download Folder as ZIP" button above the file list
- ZIP is streamed on-the-fly — no temp files created on the server
- Progress toast shows live bytes received
- Logged as `download_zip` in access logs

---

## 🔧 Configuration

Copy `.env.example` to `.env` before running. `start.bat` handles this automatically on Windows.

```env
# Server
PORT=3000
NODE_ENV=development
PUBLIC_URL=https://xyz.trycloudflare.com   # auto-set by start.bat

# JWT — regenerated automatically by start.bat on every launch
JWT_SECRET=<64-byte-random-hex>

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://xyz.trycloudflare.com

# TLS (optional — run deploy/setup-tls-windows.bat first)
TLS_ENABLED=false
TLS_CERT=./certs/nullshare.pem
TLS_KEY=./certs/nullshare-key.pem

# S3 / MinIO (optional)
S3_ENABLED=false
S3_BUCKET=nullshare
S3_REGION=us-east-1
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_ENDPOINT=
S3_PATH_STYLE=false

# End-to-End Encryption (optional — requires HTTPS)
ENCRYPTION_ENABLED=false
ENCRYPTION_SECRET=

# Threat Intelligence (optional — free API keys)
VIRUSTOTAL_KEY=    # https://www.virustotal.com  (500 req/day free)
ABUSEIPDB_KEY=     # https://www.abuseipdb.com   (1000 req/day free)
```

---

## 🐳 Docker

```bash
# Start with docker-compose (recommended)
docker-compose up -d

# Or build and run manually
docker build -t nullshare .
docker run -p 3000:3000 -v ./backend/data:/app/data nullshare
```

---

## 🧪 Testing

### Test 1 — Directory Traversal (should return 403)

```bash
TOKEN="your-share-token"
JWT="your-session-jwt"

curl -s "http://localhost:3000/api/access/$TOKEN/files?path=../../etc" \
  -H "Authorization: Bearer $JWT"
# Expected: 403 { "error": "Access denied: Invalid path" }

# URL-encoded variant
curl -s "http://localhost:3000/api/access/$TOKEN/files?path=%2e%2e%2fetc" \
  -H "Authorization: Bearer $JWT"
# Expected: 403
```

### Test 2 — Brute Force Rate Limiting (should 429 on attempt 11)

```bash
for i in {1..12}; do
  echo -n "Attempt $i: "
  curl -s -X POST "http://localhost:3000/api/access/$TOKEN/auth" \
    -H "Content-Type: application/json" \
    -d '{"password":"wrong"}' | python3 -m json.tool | grep error
done
# Attempts 1-10: "Incorrect password"
# Attempt 11+:   "Too many authentication attempts..."
```

### Test 3 — Folder ZIP Download

```bash
curl "http://localhost:3000/api/access/$TOKEN/zip?path=subfolder" \
  -H "Authorization: Bearer $JWT" \
  -o subfolder.zip
```

### Test 4 — JWT Tampering (should return 401)

```bash
# Modify the permission field in the JWT payload
# Replace middle section with base64({"permission":"download",...})
# Send modified token — signature will not match
# Expected: 401 { "error": "Invalid token" }
```

---

## 🐛 Troubleshooting

| Error | Fix |
|---|---|
| `Cross-origin request blocked` | Restart `start.bat` — it auto-patches `ALLOWED_ORIGINS` with the new tunnel URL |
| `Cannot find module 'express'` | `cd backend && npm install` |
| `Port 3000 already in use` | `netstat -ano \| findstr :3000` then `taskkill /PID <PID> /F` |
| `Tunnel URL not detected` | Check `%TEMP%\nullshare_tunnel.log` — ensure `C:\cloudflared\cloudflared.exe` exists |
| `Database locked` | `del backend\data\nullshare.db-shm backend\data\nullshare.db-wal` |
| `Rate limit exceeded` | Wait 15 minutes, or restart the server (rate limiter is in-memory) |

---

## 📈 Phase Roadmap

### ✅ Phase 1 — MVP
- Folder select + share creation
- Token-based access, file browser UI, file download

### ✅ Phase 2 — Security
- JWT auth, bcrypt passwords, path sandboxing
- Rate limiting, IP whitelisting, access logging, link expiry

### ✅ Phase 3 — Optimisation
- QR code generation
- Chunked download with real-time progress toasts
- PDF preview (iframe + pdf.js fallback)
- Folder download as ZIP (streamed, no temp files)

### ✅ Phase 4 — Advanced
- Real-time WebSocket log streaming
- ClamAV + VirusTotal malware scanning
- AES-256-GCM end-to-end encryption
- Signed time-limited download URLs (HMAC-SHA256)
- IP geolocation + AbuseIPDB reputation scoring
- CSV log export with geo data
- S3 / MinIO object storage backend
- Docker + docker-compose containerisation
- TLS / HTTPS via mkcert (local) or certbot / Let's Encrypt (prod)
- **Cloudflare Tunnel** — instant public HTTPS, zero config, zero port forwarding

---

## 🔒 Production Hardening Checklist

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Ensure `.env` is in `.gitignore` — **never commit secrets**
- [ ] Put behind Nginx with TLS — see `deploy/nginx.conf`
- [ ] Restrict dashboard (`/`) to localhost only via Nginx `allow 127.0.0.1`
- [ ] Set `PUBLIC_URL` to your actual HTTPS domain
- [ ] Enable `ENCRYPTION_ENABLED=true` (requires HTTPS)
- [ ] Add `VIRUSTOTAL_KEY` and `ABUSEIPDB_KEY` for threat intelligence
- [ ] Use a named Cloudflare Tunnel for a stable permanent URL
- [ ] Use `pm2` or `systemd` to auto-restart on crash
- [ ] Run `npm audit` regularly for dependency vulnerabilities

**Nginx snippet:**

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
2. **Dashboard has no login by default** — expose only on localhost or behind Nginx basic auth
3. **Symlinks are skipped** — intentional security trade-off to prevent sandbox escape
4. **SQLite only** — sufficient for personal / team use; swap to PostgreSQL for production scale
5. **ZIP of very large folders** — streamed efficiently but memory-intensive for millions of files

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

```
MIT License

Copyright (c) 2025 Raihaan Syed (Nullfist) — NullGrids Security

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

---

## 📞 Contact

- **Email:** [nullfist@nullgrids.com](mailto:nullfist@nullgrids.com)
- **Twitter / X:** [@nullfist](https://twitter.com/nullfist)
- **Discord:** NullGrids Community

---

<div align="center">

**Built with ❤️ by Raihaan Syed (Nullfist) · NullGrids Security · 2025**

*B.E. Computer Science — Cyber Security · United Institute of Technology*

</div>
