// utils/virusTotal.js
// NullShare — VirusTotal File Hash Scanning
//
// Public API from public-apis/public-apis:
//   VirusTotal: https://www.virustotal.com/en/documentation/public-api/
//   Free tier: 4 requests/min, 500/day
//   Requires: VIRUSTOTAL_KEY in .env
//
// Strategy:
//   1. Hash each file in the share folder (SHA-256)
//   2. Query VirusTotal for each hash (batch, rate-limited)
//   3. Return aggregated results: clean / suspicious / malicious
//
// This supplements ClamAV — works without any local install.
// Falls back gracefully if no API key is set.

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VT_KEY = () => process.env.VIRUSTOTAL_KEY; // lazy read so .env loads first
const MAX_FILES = 50;       // Don't scan more than 50 files per share (API quota)
const MAX_FILE_SIZE = 32 * 1024 * 1024; // Skip files > 32MB (hash only, no upload)
const RATE_DELAY = 15500;   // 15.5s between requests = ~4/min (free tier limit)

// ─── SHA-256 hash a file ──────────────────────────────────────────────────────
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ─── Collect all files in a directory (recursive, up to MAX_FILES) ────────────
function collectFiles(dir, files = []) {
  if (files.length >= MAX_FILES) return files;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    if (files.length >= MAX_FILES) break;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, files);
    else if (entry.isFile()) {
      try {
        const size = fs.statSync(full).size;
        if (size <= MAX_FILE_SIZE) files.push(full);
      } catch {}
    }
  }
  return files;
}

// ─── Query VirusTotal for a single SHA-256 hash ───────────────────────────────
function queryHash(sha256) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.virustotal.com',
      path: `/api/v3/files/${sha256}`,
      method: 'GET',
      headers: { 'x-apikey': VT_KEY() },
      timeout: 10000
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode === 404) return resolve({ known: false, sha256 });
          if (res.statusCode !== 200) return resolve({ known: false, sha256, error: data.error?.message });
          const stats = data.data?.attributes?.last_analysis_stats || {};
          resolve({
            known: true,
            sha256,
            malicious: stats.malicious || 0,
            suspicious: stats.suspicious || 0,
            undetected: stats.undetected || 0,
            harmless: stats.harmless || 0,
            name: data.data?.attributes?.meaningful_name || path.basename(sha256)
          });
        } catch { resolve({ known: false, sha256 }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('VT timeout')); });
    req.end();
  });
}

// ─── Sleep helper for rate limiting ──────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Main: scan a directory via VirusTotal hash lookup ───────────────────────
async function scanWithVirusTotal(dirPath) {
  if (!VT_KEY()) {
    return { status: 'skipped', message: 'VIRUSTOTAL_KEY not set in .env', results: [] };
  }

  const files = collectFiles(dirPath);
  if (!files.length) {
    return { status: 'clean', message: '0 files to scan', results: [] };
  }

  const results = [];
  let maliciousCount = 0;
  let suspiciousCount = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    let sha256;
    try { sha256 = await hashFile(filePath); } catch { continue; }

    let vtResult;
    try {
      vtResult = await queryHash(sha256);
    } catch {
      vtResult = { known: false, sha256 };
    }

    vtResult.file = path.relative(dirPath, filePath).replace(/\\/g, '/');
    results.push(vtResult);

    if (vtResult.malicious > 0) maliciousCount++;
    if (vtResult.suspicious > 0) suspiciousCount++;

    // Rate limit: wait between requests (except after last)
    if (i < files.length - 1) await sleep(RATE_DELAY);
  }

  const scanned = results.filter(r => r.known).length;
  const unknown = results.filter(r => !r.known).length;

  if (maliciousCount > 0) {
    const threats = results.filter(r => r.malicious > 0).map(r => `${r.file} (${r.malicious} engines)`);
    return {
      status: 'infected',
      message: `${maliciousCount} malicious file(s) detected by VirusTotal`,
      threats,
      results,
      scanned,
      unknown
    };
  }

  return {
    status: suspiciousCount > 0 ? 'suspicious' : 'clean',
    message: `${scanned} files checked, ${unknown} unknown hashes, ${maliciousCount} malicious, ${suspiciousCount} suspicious`,
    results,
    scanned,
    unknown
  };
}

// ─── Format for API response (matches malwareScan.js formatScanResult shape) ──
function formatVTResult(result) {
  if (result.status === 'skipped') return { status: 'skipped', message: result.message };
  if (result.status === 'infected') return { status: 'infected', message: result.message, threats: result.threats };
  if (result.status === 'suspicious') return { status: 'suspicious', message: result.message };
  return { status: 'clean', message: result.message };
}

module.exports = { scanWithVirusTotal, formatVTResult };
