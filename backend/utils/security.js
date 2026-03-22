// utils/security.js
// NullShare - Security utilities
// This is the MOST CRITICAL module - handles all path safety and token logic

const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: JWT_SECRET must be set in production');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

// ─── Token Generation ─────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure share token
 * Uses 32 bytes = 256-bit entropy, URL-safe base64
 * This is the PUBLIC token embedded in share links
 */
function generateShareToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Issue a short-lived JWT for an authenticated session on a share
 * This is issued AFTER password verification (if required)
 * 
 * @param {string} shareId - The share UUID
 * @param {string} permission - 'view' or 'download'
 * @param {number} expiresIn - seconds until JWT expires
 */
function issueSessionJWT(shareId, permission, expiresIn = 3600) {
  return jwt.sign(
    { shareId, permission, type: 'share_session' },
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Verify a session JWT
 * Returns decoded payload or throws
 */
function verifySessionJWT(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── Password Handling ────────────────────────────────────────────────────────

/**
 * Hash a password for storage
 * Cost factor 12 = ~250ms on modern hardware (good enough, not too slow)
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

/**
 * Safely compare password against stored hash (timing-safe via bcrypt)
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ─── Path Sandboxing (MOST CRITICAL SECURITY FEATURE) ────────────────────────

/**
 * Safely resolve a relative file path within a sandboxed root.
 * 
 * This prevents directory traversal attacks like:
 *   ../../etc/passwd
 *   %2e%2e%2fetc%2fpasswd
 *   ..%252f (double-encoded)
 * 
 * The algorithm:
 * 1. Resolve the ROOT to an absolute path (no symlinks ambiguity)
 * 2. Resolve the requested path relative to root
 * 3. Verify the result STARTS WITH the root path
 * 4. If not → traversal attempt → DENY
 * 
 * @param {string} rootDir - The sandboxed root directory (absolute)
 * @param {string} requestedPath - User-supplied relative path
 * @returns {string} Safe absolute path
 * @throws {Error} If traversal attempt detected
 */
function safePath(rootDir, requestedPath) {
  // Normalize root to absolute
  const root = path.resolve(rootDir);
  
  // Clean the requested path:
  // - Decode URL encoding once (double-encoding attacks)
  // - Normalize separators
  // - Remove null bytes (null-byte injection)
  let cleanPath = requestedPath || '';
  
  // Reject null bytes immediately
  if (cleanPath.includes('\0')) {
    throw new Error('TRAVERSAL: Null byte detected');
  }
  
  // Decode percent-encoding (handle %2e%2e%2f type attacks)
  try {
    cleanPath = decodeURIComponent(cleanPath);
  } catch {
    throw new Error('TRAVERSAL: Invalid URL encoding');
  }
  
  // Re-check for null bytes after decoding
  if (cleanPath.includes('\0')) {
    throw new Error('TRAVERSAL: Null byte in decoded path');
  }
  
  // Resolve full path (path.resolve handles .. normalization)
  const resolved = path.resolve(root, cleanPath);
  
  // THE CORE CHECK: resolved path must start with root
  // Add trailing sep to prevent /rootdir-evil matching /rootdir
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`TRAVERSAL: Path escapes sandbox. Root: ${root}, Resolved: ${resolved}`);
  }
  
  return resolved;
}

/**
 * Get relative path from root (for display purposes)
 * Returns '/' for the root itself
 */
function relativePath(rootDir, absolutePath) {
  const root = path.resolve(rootDir);
  const rel = path.relative(root, absolutePath);
  return rel === '' ? '/' : '/' + rel.replace(/\\/g, '/');
}

// ─── IP Utilities ─────────────────────────────────────────────────────────────

/**
 * Extract real IP from request
 * Handles X-Forwarded-For (if behind proxy) with a fallback
 */
function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Check if an IP is in the whitelist
 * @param {string} ip - Client IP
 * @param {string|null} whitelist - JSON string of allowed IPs, or null = allow all
 */
function isIPAllowed(ip, whitelist) {
  if (!whitelist) return true; // No restriction
  try {
    const allowed = JSON.parse(whitelist);
    return allowed.includes(ip);
  } catch {
    return false;
  }
}

// ─── Share Validity Check ─────────────────────────────────────────────────────

/**
 * Check if a share is currently valid (not expired, not revoked)
 * @param {Object} share - Share record from DB
 * @returns {{ valid: boolean, reason: string }}
 */
function validateShare(share) {
  if (!share) return { valid: false, reason: 'Share not found' };
  if (!share.is_active) return { valid: false, reason: 'Share has been revoked' };
  if (share.expires_at && Date.now() > share.expires_at) {
    return { valid: false, reason: 'Share link has expired' };
  }
  return { valid: true, reason: null };
}

module.exports = {
  generateShareToken,
  issueSessionJWT,
  verifySessionJWT,
  hashPassword,
  verifyPassword,
  safePath,
  relativePath,
  getClientIP,
  isIPAllowed,
  validateShare
};
