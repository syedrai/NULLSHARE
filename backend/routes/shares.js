// routes/shares.js  (v2 — All phases complete)
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const { generateShareToken, hashPassword } = require('../utils/security');
const { generateSignedUrl } = require('../utils/signedUrl');
const { scanPath, formatScanResult } = require('../utils/malwareScan');
const { scanWithVirusTotal, formatVTResult } = require('../utils/virusTotal');
const { enrichIPs } = require('../utils/ipReputation');
const { createShare, listShares, getShareById, revokeShare, getLogsForShare, getRecentLogs } = require('../db/database');

let QRCode;
try { QRCode = require('qrcode'); } catch { QRCode = null; }

// ─── POST /api/shares ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { folderPath, label, permission = 'view', expiresInMinutes, password, allowedIPs, scanBeforeShare = false } = req.body;

  if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });

  let resolvedPath;
  try { resolvedPath = path.resolve(folderPath); } catch { return res.status(400).json({ error: 'Invalid folder path' }); }
  if (!fs.existsSync(resolvedPath)) return res.status(400).json({ error: 'Folder path does not exist' });
  if (!fs.statSync(resolvedPath).isDirectory()) return res.status(400).json({ error: 'Path must be a directory' });
  if (!['view', 'download'].includes(permission)) return res.status(400).json({ error: "Permission must be 'view' or 'download'" });

  let scanResult = null;
  if (scanBeforeShare) {
    const raw = await scanPath(resolvedPath);
    scanResult = formatScanResult(raw);
    if (scanResult.status === 'infected') {
      return res.status(400).json({ error: 'Share blocked: malware detected', scan: scanResult });
    }
  }

  let passwordHash = null;
  if (password?.trim()) passwordHash = await hashPassword(password.trim());
  let expiresAt = null;
  if (expiresInMinutes && Number(expiresInMinutes) > 0) expiresAt = Date.now() + Number(expiresInMinutes) * 60 * 1000;
  let ipWhitelist = null;
  if (allowedIPs?.length) ipWhitelist = JSON.stringify(allowedIPs.filter(ip => ip.trim()));

  const shareId = uuidv4();
  const token = generateShareToken();

  try {
    createShare.run({ id: shareId, token, folder_path: resolvedPath, label: label || path.basename(resolvedPath), password_hash: passwordHash, permission, expires_at: expiresAt, ip_whitelist: ipWhitelist, created_at: Date.now() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create share' });
  }

  const host = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const shareUrl = `${host}/share/${token}`;

  let qrCode = null;
  if (QRCode) {
    try { qrCode = await QRCode.toDataURL(shareUrl, { width: 256, margin: 2 }); } catch {}
  }

  res.status(201).json({ shareId, token, shareUrl, label: label || path.basename(resolvedPath), permission, expiresAt, passwordProtected: !!passwordHash, ipRestricted: !!ipWhitelist, qrCode, scan: scanResult });
});

router.get('/', (req, res) => res.json(listShares.all()));

// ── Static sub-routes MUST come before /:id to avoid param shadowing ──────────
router.get('/logs/all', (req, res) => res.json(getRecentLogs.all()));

router.get('/logs/export', async (req, res) => {
  const logs = getRecentLogs.all();
  const ips = logs.map(l => l.ip_address).filter(Boolean);
  const geoMap = await enrichIPs(ips).catch(() => ({}));
  const header = 'id,share_id,label,ip_address,country,city,flag,abuse_score,user_agent,action,file_path,status,timestamp\n';
  const rows = logs.map(l => {
    const geo = geoMap[l.ip_address] || {};
    return [
      l.id, l.share_id,
      csvEscape(l.label || ''),
      l.ip_address,
      geo.country || '',
      csvEscape(geo.city || ''),
      geo.flag || '',
      geo.abuseScore != null ? geo.abuseScore : '',
      csvEscape(l.user_agent || ''),
      l.action,
      csvEscape(l.file_path || ''),
      l.status,
      new Date(l.timestamp).toISOString()
    ].join(',');
  }).join('\n');
  const filename = `nullshare-logs-${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(header + rows);
});

// ── Per-share routes ──────────────────────────────────────────────────────────
router.get('/:id', (req, res) => { const s = getShareById.get(req.params.id); if (!s) return res.status(404).json({ error: 'Not found' }); res.json(s); });
router.delete('/:id', (req, res) => { const s = getShareById.get(req.params.id); if (!s) return res.status(404).json({ error: 'Not found' }); revokeShare.run(req.params.id); res.json({ success: true }); });
router.get('/:id/logs', (req, res) => { const s = getShareById.get(req.params.id); if (!s) return res.status(404).json({ error: 'Not found' }); res.json(getLogsForShare.all(req.params.id)); });

router.post('/:id/scan', async (req, res) => {
  const share = getShareById.get(req.params.id);
  if (!share) return res.status(404).json({ error: 'Share not found' });
  const engine = req.query.engine || 'auto'; // auto | clamav | virustotal
  let scan;
  if (engine === 'virustotal') {
    const raw = await scanWithVirusTotal(share.folder_path);
    scan = formatVTResult(raw);
  } else {
    const raw = await scanPath(share.folder_path);
    scan = formatScanResult(raw);
    // If auto and skipped, also try VT if key is set
    if (engine === 'auto' && scan.status === 'skipped' && process.env.VIRUSTOTAL_KEY) {
      const vtRaw = await scanWithVirusTotal(share.folder_path);
      scan = formatVTResult(vtRaw);
    }
  }
  res.json({ shareId: share.id, label: share.label, scan });
});

function csvEscape(s) {
  if (!s) return '';
  const str = String(s).replace(/"/g, '""');
  return /[,"\n\r]/.test(str) ? `"${str}"` : str;
}

router.post('/:id/signed-url', (req, res) => {
  const share = getShareById.get(req.params.id);
  if (!share) return res.status(404).json({ error: 'Share not found' });
  if (share.permission !== 'download') return res.status(403).json({ error: 'Share is view-only' });
  const { filePath, ttl = 300 } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  const qs = generateSignedUrl(share.id, filePath, ttl);
  const host = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({ signedUrl: `${host}/dl?${qs}`, expiresIn: ttl, filePath });
});

module.exports = router;
