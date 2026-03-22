// utils/signedUrl.js
// NullShare — Signed Download URLs
//
// A signed URL lets a receiver download a file directly (no Bearer header needed)
// while still being:
//   - Time-limited (expires in N seconds)
//   - Cryptographically verified (HMAC-SHA256)
//   - Bound to a specific file path
//
// Use case: Embed download URLs in HTML <a> tags so browsers can
//           download files natively without JavaScript fetch() tricks.
//
// Flow:
//   1. Receiver requests a signed URL via authenticated API call
//   2. Server generates: sig = HMAC(shareId + filePath + expiry, SECRET)
//   3. URL = /dl?shareId=X&path=Y&exp=T&sig=HMAC
//   4. Receiver clicks link → server verifies sig + expiry → streams file

const crypto = require('crypto');

const SIGN_SECRET = process.env.SIGN_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const DEFAULT_TTL = 300; // 5 minutes

/**
 * Generate a signed download URL for a file within a share
 *
 * @param {string} shareId  - The share UUID (not the public token)
 * @param {string} filePath - Relative file path within the share
 * @param {number} ttl      - Seconds until URL expires (default 5 min)
 * @returns {string}        - Query string (append to /dl?)
 */
function generateSignedUrl(shareId, filePath, ttl = DEFAULT_TTL) {
  const expiry = Math.floor(Date.now() / 1000) + ttl;

  // Payload to sign: shareId|filePath|expiry
  // Using | delimiter to prevent concatenation attacks
  const payload = `${shareId}|${filePath}|${expiry}`;

  const sig = crypto
    .createHmac('sha256', SIGN_SECRET)
    .update(payload)
    .digest('base64url');

  // Return as query params (caller appends to URL)
  const params = new URLSearchParams({
    shareId,
    path: filePath,
    exp: expiry,
    sig
  });

  return params.toString();
}

/**
 * Verify a signed download URL
 *
 * @param {string} shareId  - From query param
 * @param {string} filePath - From query param
 * @param {number} expiry   - From query param (unix timestamp)
 * @param {string} sig      - From query param
 * @returns {{ valid: boolean, reason: string }}
 */
function verifySignedUrl(shareId, filePath, expiry, sig) {
  // Check expiry first (fast, no crypto)
  if (!expiry || Math.floor(Date.now() / 1000) > Number(expiry)) {
    return { valid: false, reason: 'Signed URL has expired' };
  }

  // Recompute expected signature
  const payload = `${shareId}|${filePath}|${expiry}`;
  const expected = crypto
    .createHmac('sha256', SIGN_SECRET)
    .update(payload)
    .digest('base64url');

  // Timing-safe comparison to prevent timing attacks
  try {
    const sigBuf      = Buffer.from(sig, 'base64url');
    const expectedBuf = Buffer.from(expected, 'base64url');

    if (sigBuf.length !== expectedBuf.length) {
      return { valid: false, reason: 'Invalid signature' };
    }

    const match = crypto.timingSafeEqual(sigBuf, expectedBuf);
    if (!match) return { valid: false, reason: 'Invalid signature' };

  } catch {
    return { valid: false, reason: 'Malformed signature' };
  }

  return { valid: true, reason: null };
}

module.exports = { generateSignedUrl, verifySignedUrl };
