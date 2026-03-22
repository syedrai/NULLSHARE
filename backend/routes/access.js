// routes/access.js
// NullShare - File Access API (Receiver-facing)
// Routes that the RECEIVER uses to access shared content

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const {
  verifyPassword,
  issueSessionJWT,
  safePath,
  relativePath,
  getClientIP,
  isIPAllowed,
  validateShare
} = require('../utils/security');

const localFS = require('../utils/fileSystem');
const s3 = require('../utils/s3Storage');
const { EncryptStream, generateEncryptionHeaders, isEnabled: encEnabled } = require('../utils/encryption');
const { enrichIP } = require('../utils/ipReputation');

// Use S3 or local filesystem based on env flag
function getFS() { return s3.isEnabled() ? s3 : localFS; }
function getSafePath() { return s3.isEnabled() ? s3.safePath : safePath; }

const {
  listDirectory,
  streamFile,
  isFile,
  isDirectory
} = localFS; // kept for direct use; getFS() used in handlers

const { getShareByToken, logAccess } = require('../db/database');
const { requireShareAuth, requireDownloadPermission } = require('../middleware/auth');

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Brute-force protection on auth endpoint
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // Max 10 attempts per 15min per IP
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// General rate limit for file access
const fileRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // 120 requests/min = generous for browsing
  message: { error: 'Rate limit exceeded. Please slow down.' }
});

// ─── Helper: Log and Respond ──────────────────────────────────────────────────
function logAndDeny(shareId, req, action, reason) {
  logAccess.run({
    share_id: shareId,
    ip_address: getClientIP(req),
    user_agent: req.get('user-agent') || 'unknown',
    action,
    file_path: null,
    status: 'denied',
    timestamp: Date.now()
  });
  return reason;
}

// ─── POST /api/access/:token/auth ─────────────────────────────────────────────
// Authenticate against a share (password check, IP check, validity check)
// Returns a session JWT on success
router.post('/:token/auth', authRateLimit, async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  const clientIP = getClientIP(req);

  // Load share
  const share = getShareByToken.get(token);

  // Validate share existence and expiry
  const { valid, reason } = validateShare(share);
  if (!valid) {
    if (share) {
      logAndDeny(share.id, req, 'auth_fail', reason);
    }
    // Deliberately vague error for non-existent shares (don't leak info)
    return res.status(403).json({ error: reason || 'Invalid or expired share link' });
  }

  // IP whitelist check
  if (!isIPAllowed(clientIP, share.ip_whitelist)) {
    logAndDeny(share.id, req, 'auth_fail', 'IP not whitelisted');
    return res.status(403).json({ error: 'Access denied from your IP address' });
  }

  // Password check (if share is password-protected)
  if (share.password_hash) {
    if (!password) {
      return res.status(401).json({ 
        error: 'Password required',
        code: 'PASSWORD_REQUIRED'
      });
    }
    const passwordValid = await verifyPassword(password, share.password_hash);
    if (!passwordValid) {
      logAccess.run({
        share_id: share.id,
        ip_address: clientIP,
        user_agent: req.get('user-agent') || 'unknown',
        action: 'auth_fail',
        file_path: null,
        status: 'denied',
        timestamp: Date.now()
      });
      return res.status(401).json({ error: 'Incorrect password' });
    }
  }

  // ── All checks passed — issue session JWT ─────────────────────────────────
  // JWT expires when the share expires, or in 24h, whichever is sooner
  let jwtExpiry = 86400; // 24 hours default
  if (share.expires_at) {
    const remaining = Math.floor((share.expires_at - Date.now()) / 1000);
    jwtExpiry = Math.min(jwtExpiry, remaining);
  }

  const sessionToken = issueSessionJWT(share.id, share.permission, jwtExpiry);

  // Log successful auth
  logAccess.run({
    share_id: share.id,
    ip_address: clientIP,
    user_agent: req.get('user-agent') || 'unknown',
    action: 'auth_success',
    file_path: null,
    status: 'allowed',
    timestamp: Date.now()
  });

  res.json({
    sessionToken,
    permission: share.permission,
    label: share.label,
    expiresAt: share.expires_at
  });
});

// ─── GET /api/access/:token/info ──────────────────────────────────────────────
// Public endpoint: get share info without auth (for UI to know if password needed)
router.get('/:token/info', (req, res) => {
  const share = getShareByToken.get(req.params.token);
  const { valid, reason } = validateShare(share);

  if (!valid) {
    return res.status(404).json({ error: reason || 'Share not found' });
  }

  res.json({
    label: share.label,
    permission: share.permission,
    passwordProtected: !!share.password_hash,
    expiresAt: share.expires_at
  });
});

// ─── GET /api/access/:token/files ─────────────────────────────────────────────
router.get('/:token/files', fileRateLimit, requireShareAuth, async (req, res) => {
  const { share } = req;
  const clientIP = getClientIP(req);
  const requestedPath = req.query.path || '';
  const fs = getFS();
  const sp = getSafePath();

  let safeDirPath;
  try {
    safeDirPath = sp(share.folder_path, requestedPath);
  } catch (err) {
    console.warn(`[SECURITY] Traversal attempt from ${clientIP}: ${err.message}`);
    logAccess.run({ share_id: share.id, ip_address: clientIP, user_agent: req.get('user-agent') || 'unknown', action: 'traversal_attempt', file_path: requestedPath, status: 'denied', timestamp: Date.now() });
    return res.status(403).json({ error: 'Access denied: Invalid path' });
  }

  const dirOk = s3.isEnabled() ? await fs.isDirectory(safeDirPath) : localFS.isDirectory(safeDirPath);
  if (!dirOk) return res.status(400).json({ error: 'Requested path is not a directory' });

  let entries;
  try {
    entries = await fs.listDirectory(safeDirPath, share.folder_path);
  } catch {
    return res.status(500).json({ error: 'Cannot read directory' });
  }

  logAccess.run({ share_id: share.id, ip_address: clientIP, user_agent: req.get('user-agent') || 'unknown', action: 'view_index', file_path: requestedPath || '/', status: 'allowed', timestamp: Date.now() });
  res.json({ path: requestedPath || '/', entries, permission: share.permission });
});

// ─── GET /api/access/:token/download ─────────────────────────────────────────
router.get('/:token/download', fileRateLimit, requireShareAuth, requireDownloadPermission, async (req, res) => {
  const { share } = req;
  const clientIP = getClientIP(req);
  const requestedPath = req.query.path;
  if (!requestedPath) return res.status(400).json({ error: 'path query parameter required' });

  const fs = getFS();
  const sp = getSafePath();

  let safeFilePath;
  try {
    safeFilePath = sp(share.folder_path, requestedPath);
  } catch (err) {
    console.warn(`[SECURITY] Traversal on download from ${clientIP}: ${err.message}`);
    logAccess.run({ share_id: share.id, ip_address: clientIP, user_agent: req.get('user-agent') || 'unknown', action: 'traversal_attempt', file_path: requestedPath, status: 'denied', timestamp: Date.now() });
    return res.status(403).json({ error: 'Access denied: Invalid path' });
  }

  const fileOk = s3.isEnabled() ? await fs.isFile(safeFilePath) : localFS.isFile(safeFilePath);
  if (!fileOk) return res.status(400).json({ error: 'Requested path is not a file' });

  logAccess.run({ share_id: share.id, ip_address: clientIP, user_agent: req.get('user-agent') || 'unknown', action: 'download', file_path: requestedPath, status: 'allowed', timestamp: Date.now() });

  // Optionally encrypt the stream
  if (encEnabled()) {
    const { key, headers, keyB64 } = generateEncryptionHeaders(share.id, requestedPath);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('X-Encryption-Key', keyB64); // only safe over HTTPS
    // Pipe through encrypt stream
    const { EncryptStream: ES } = require('../utils/encryption');
    const encStream = new ES(key);
    if (s3.isEnabled()) {
      await fs.streamFile(safeFilePath, req, res, 'attachment', encStream);
    } else {
      localFS.streamFile(safeFilePath, req, res, 'attachment', encStream);
    }
  } else {
    if (s3.isEnabled()) {
      await fs.streamFile(safeFilePath, req, res, 'attachment');
    } else {
      localFS.streamFile(safeFilePath, req, res, 'attachment');
    }
  }
});

// ─── GET /api/access/:token/preview ──────────────────────────────────────────
router.get('/:token/preview', fileRateLimit, requireShareAuth, async (req, res) => {
  const { share } = req;
  const clientIP = getClientIP(req);
  const requestedPath = req.query.path;
  if (!requestedPath) return res.status(400).json({ error: 'path query parameter required' });

  const fs = getFS();
  const sp = getSafePath();

  let safeFilePath;
  try {
    safeFilePath = sp(share.folder_path, requestedPath);
  } catch {
    return res.status(403).json({ error: 'Access denied: Invalid path' });
  }

  const fileOk = s3.isEnabled() ? await fs.isFile(safeFilePath) : localFS.isFile(safeFilePath);
  if (!fileOk) return res.status(400).json({ error: 'Requested path is not a file' });

  logAccess.run({ share_id: share.id, ip_address: clientIP, user_agent: req.get('user-agent') || 'unknown', action: 'view_file', file_path: requestedPath, status: 'allowed', timestamp: Date.now() });

  if (s3.isEnabled()) {
    await fs.streamFile(safeFilePath, req, res, 'inline');
  } else {
    localFS.streamFile(safeFilePath, req, res, 'inline');
  }
});

// ─── GET /api/access/:token/zip ─────────────────────────────────────────────
// Download a folder (or entire share root) as a ZIP archive
router.get('/:token/zip', fileRateLimit, requireShareAuth, requireDownloadPermission, async (req, res) => {
  const { share } = req;
  const clientIP = getClientIP(req);
  const requestedPath = req.query.path || '';
  const archiver = require('archiver');

  let safeDirPath;
  try {
    safeDirPath = safePath(share.folder_path, requestedPath);
  } catch (err) {
    logAccess.run({ share_id: share.id, ip_address: clientIP, user_agent: req.get('user-agent') || 'unknown', action: 'traversal_attempt', file_path: requestedPath, status: 'denied', timestamp: Date.now() });
    return res.status(403).json({ error: 'Access denied: Invalid path' });
  }

  if (!localFS.isDirectory(safeDirPath)) return res.status(400).json({ error: 'Path is not a directory' });

  const folderName = require('path').basename(safeDirPath) || 'nullshare';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(folderName)}.zip"`);

  logAccess.run({ share_id: share.id, ip_address: clientIP, user_agent: req.get('user-agent') || 'unknown', action: 'download_zip', file_path: requestedPath || '/', status: 'allowed', timestamp: Date.now() });

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { console.error('[ZIP]', err.message); res.end(); });
  archive.pipe(res);
  archive.directory(safeDirPath, false);
  archive.finalize();
});

// ─── GET /api/access/:token/ip-info ──────────────────────────────────────────
// Returns geo + reputation info for the caller's IP (used by receiver UI)
router.get('/:token/ip-info', requireShareAuth, async (req, res) => {
  const ip = getClientIP(req);
  const info = await enrichIP(ip).catch(() => ({ flag: '🌐', country: '??' }));
  res.json({ ip, ...info });
});

module.exports = router;
