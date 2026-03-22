// middleware/auth.js
// NullShare - Authentication middleware
// Validates share session JWTs on protected routes

const { verifySessionJWT, getClientIP } = require('../utils/security');
const { getShareById, logAccess } = require('../db/database');

/**
 * Middleware: requireShareAuth
 * 
 * Validates the Bearer JWT on share access routes.
 * The JWT was issued at /api/share/:token/auth after password verification.
 * 
 * Flow:
 *   1. Extract Bearer token from Authorization header
 *   2. Verify JWT signature + expiry
 *   3. Load share from DB (confirm still active)
 *   4. Attach share to req for downstream use
 * 
 * Usage: router.get('/files', requireShareAuth, handler)
 */
async function requireShareAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Authentication required',
      code: 'NO_TOKEN'
    });
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = verifySessionJWT(token);
  } catch (err) {
    // JWT expired or tampered
    return res.status(401).json({ 
      error: err.name === 'TokenExpiredError' ? 'Session expired, please re-authenticate' : 'Invalid token',
      code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    });
  }

  // Confirm the share still exists and is active
  const share = getShareById.get(payload.shareId);
  if (!share || !share.is_active) {
    return res.status(403).json({ 
      error: 'Share no longer available',
      code: 'SHARE_UNAVAILABLE'
    });
  }

  // Check expiry again (in case it expired after JWT was issued)
  if (share.expires_at && Date.now() > share.expires_at) {
    logAccess.run({
      share_id: share.id,
      ip_address: getClientIP(req),
      user_agent: req.get('user-agent') || 'unknown',
      action: 'expired_access',
      file_path: null,
      status: 'denied',
      timestamp: Date.now()
    });
    return res.status(403).json({ 
      error: 'Share link has expired',
      code: 'SHARE_EXPIRED'
    });
  }

  // Attach share and permission to request for route handlers
  req.share = share;
  req.sharePermission = payload.permission;
  next();
}

/**
 * Middleware: requireDownloadPermission
 * Must be used AFTER requireShareAuth
 * 
 * Blocks download attempts on view-only shares
 */
function requireDownloadPermission(req, res, next) {
  if (req.sharePermission !== 'download') {
    logAccess.run({
      share_id: req.share.id,
      ip_address: getClientIP(req),
      user_agent: req.get('user-agent') || 'unknown',
      action: 'download',
      file_path: req.query.path || null,
      status: 'denied',
      timestamp: Date.now()
    });
    return res.status(403).json({ 
      error: 'This share is view-only. Downloads are not permitted.',
      code: 'DOWNLOAD_DENIED'
    });
  }
  next();
}

module.exports = { requireShareAuth, requireDownloadPermission };
