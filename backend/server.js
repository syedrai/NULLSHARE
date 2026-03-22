// server.js — NullShare v2.0 (All phases complete)
require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const sharesRouter = require('./routes/shares');
const accessRouter = require('./routes/access');
const { attachWebSocketServer } = require('./utils/logBroadcaster');
const { verifySignedUrl } = require('./utils/signedUrl');
const { getShareById } = require('./db/database');
const { safePath } = require('./utils/security');
const { streamFile, isFile } = require('./utils/fileSystem');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Helmet (no CSP — handled below) ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
function isOriginAllowed(origin) {
  if (!origin) return true;
  if (origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000') return true;
  if (origin.endsWith('.trycloudflare.com')) return true;
  const pub = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (pub && origin === pub) return true;
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return extra.includes(origin);
}

const corsOptions = {
  origin: (origin, cb) => isOriginAllowed(origin) ? cb(null, true) : cb(new Error(`CORS: ${origin} not allowed`)),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ─── Dynamic CSP ──────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const pub = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const pubWs = pub.replace(/^https/, 'wss').replace(/^http/, 'ws');
  const tunnelSrc = pub.endsWith('.trycloudflare.com') ? '' : ' https://*.trycloudflare.com wss://*.trycloudflare.com';
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob: https://cdnjs.cloudflare.com",
    `connect-src 'self' ws://localhost:3000 wss://localhost:3000 https://ipapi.co https://*.trycloudflare.com wss://*.trycloudflare.com${pub ? ' ' + pub : ''}${pubWs ? ' ' + pubWs : ''}`
  ].join('; '));
  next();
});

app.use(rateLimit({ windowMs: 60000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(morgan('combined'));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Localhost-only guard for sharer dashboard + API ─────────────────────────
function localhostOnly(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || '';
  const clean = ip.replace(/^::ffff:/, '');
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return next();
  return res.status(403).json({ error: 'Sharer dashboard is only accessible from localhost' });
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/shares', localhostOnly, sharesRouter);
app.use('/api/access', accessRouter);

// ─── Signed Direct Download Endpoint ─────────────────────────────────────────
// GET /dl?shareId=X&path=Y&exp=T&sig=HMAC
// No Bearer token needed — URL itself is the credential
app.get('/dl', (req, res) => {
  const { shareId, path: filePath, exp, sig } = req.query;

  if (!shareId || !filePath || !exp || !sig) {
    return res.status(400).send('Missing parameters');
  }

  const { valid, reason } = verifySignedUrl(shareId, filePath, exp, sig);
  if (!valid) return res.status(403).send(reason || 'Invalid or expired link');

  const share = getShareById.get(shareId);
  if (!share || !share.is_active) return res.status(403).send('Share unavailable');
  if (share.permission !== 'download') return res.status(403).send('Share is view-only');

  let safeFilePath;
  try {
    safeFilePath = safePath(share.folder_path, filePath);
  } catch {
    return res.status(403).send('Access denied');
  }

  if (!isFile(safeFilePath)) return res.status(404).send('File not found');

  streamFile(safeFilePath, req, res, 'attachment');
});

// ─── Frontend Routes ──────────────────────────────────────────────────────────
app.get('/', localhostOnly, (req, res) => res.sendFile(path.join(__dirname, '../frontend/sharer/index.html')));
app.get('/share/:token', (req, res) => res.sendFile(path.join(__dirname, '../frontend/receiver/index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString(), version: '2.0.0' }));

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (err.message?.startsWith('CORS:')) return res.status(403).json({ error: 'Cross-origin request blocked' });
  res.status(500).json({ error: 'Internal server error' });
});
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── HTTP + WebSocket Server (with optional TLS) ─────────────────────────────
const TLS_ENABLED = process.env.TLS_ENABLED === 'true';
let server;

if (TLS_ENABLED) {
  const certPath = process.env.TLS_CERT || './certs/nullshare.pem';
  const keyPath  = process.env.TLS_KEY  || './certs/nullshare-key.pem';
  let tlsOpts;
  try {
    tlsOpts = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  } catch (e) {
    console.error(`[TLS] Cannot read cert/key: ${e.message}`);
    console.error('[TLS] Run deploy/setup-tls-windows.bat (Windows) or deploy/setup-tls.sh local (Linux/Mac)');
    process.exit(1);
  }
  server = https.createServer(tlsOpts, app);
  // Also spin up HTTP → HTTPS redirect on PORT+1
  const redirectPort = Number(PORT) + 1;
  http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host?.replace(/:.*/, '')}:${PORT}${req.url}` });
    res.end();
  }).listen(redirectPort, () => console.log(`[TLS] HTTP→HTTPS redirect on :${redirectPort}`));
} else {
  server = http.createServer(app);
}

attachWebSocketServer(server);

const proto = TLS_ENABLED ? 'https' : 'http';
const wsProto = TLS_ENABLED ? 'wss' : 'ws';

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║      NullShare by NullGrids v2.0.0       ║
║   All Phases Complete — Production Ready ║
╠══════════════════════════════════════════╣
║  Dashboard : ${proto}://localhost:${PORT}         ║
║  WebSocket : ${wsProto}://localhost:${PORT}/ws/logs  ║
║  Signed DL : ${proto}://localhost:${PORT}/dl     ║
║  TLS       : ${TLS_ENABLED ? 'ENABLED  ✓' : 'disabled (HTTP)'}                  ║
║  S3        : ${process.env.S3_ENABLED === 'true' ? 'ENABLED  ✓' : 'disabled (local FS)'}             ║
║  Encrypt   : ${process.env.ENCRYPTION_ENABLED === 'true' ? 'ENABLED  ✓' : 'disabled'}                  ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
