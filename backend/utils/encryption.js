// utils/encryption.js
// NullShare — End-to-End Encryption (AES-256-GCM)
//
// Provides stream-based AES-256-GCM encryption/decryption for file transfers.
//
// How it works:
//   - Each download session gets a unique 256-bit key derived from the share token
//     + a per-request nonce using HKDF (HMAC-based Key Derivation Function)
//   - The IV (12 bytes) is prepended to the ciphertext stream
//   - The auth tag (16 bytes) is appended — guarantees integrity
//   - The receiver JS decrypts using the Web Crypto API (SubtleCrypto)
//
// Wire format (encrypted download):
//   [ 12 bytes IV ][ N bytes ciphertext ][ 16 bytes GCM auth tag ]
//
// Key exchange:
//   - Server derives per-file key: HKDF(masterSecret, shareId + filePath + nonce)
//   - Key material is sent to authenticated receiver as part of the download response
//     header: X-Encryption-Key (base64url encoded, only over HTTPS)
//
// Enabled via: ENCRYPTION_ENABLED=true in .env
// Master secret: ENCRYPTION_SECRET in .env (auto-generated if not set)

const crypto = require('crypto');
const { Transform } = require('stream');

const MASTER_SECRET = process.env.ENCRYPTION_SECRET || crypto.randomBytes(32).toString('hex');
const IV_LENGTH = 12;   // 96-bit IV for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag

// ─── Derive a per-file AES-256 key using HKDF ────────────────────────────────
function deriveKey(shareId, filePath, nonce) {
  // HKDF: extract + expand
  // Input key material = master secret
  // Info = shareId|filePath|nonce (domain separation)
  const ikm = Buffer.from(MASTER_SECRET, 'hex');
  const salt = crypto.randomBytes(32); // not stored — we use HMAC-based derivation
  const info = Buffer.from(`${shareId}|${filePath}|${nonce}`);

  // Use HMAC-SHA256 as the PRF (Node's built-in hkdfSync)
  const key = crypto.hkdfSync('sha256', ikm, salt, info, 32);
  return { key: Buffer.from(key), salt: salt.toString('base64url') };
}

// ─── Derive key deterministically (for decryption — needs same salt) ─────────
function deriveKeyFromSalt(shareId, filePath, nonce, saltB64) {
  const ikm = Buffer.from(MASTER_SECRET, 'hex');
  const salt = Buffer.from(saltB64, 'base64url');
  const info = Buffer.from(`${shareId}|${filePath}|${nonce}`);
  const key = crypto.hkdfSync('sha256', ikm, salt, info, 32);
  return Buffer.from(key);
}

// ─── Encrypt Transform Stream ─────────────────────────────────────────────────
// Wraps a readable file stream, outputs: [IV][ciphertext][auth tag]
class EncryptStream extends Transform {
  constructor(key) {
    super();
    this._iv = crypto.randomBytes(IV_LENGTH);
    this._cipher = crypto.createCipheriv('aes-256-gcm', key, this._iv);
    this._headerSent = false;
  }

  get iv() { return this._iv; }

  _transform(chunk, _enc, cb) {
    if (!this._headerSent) {
      // Prepend IV on first chunk
      this.push(this._iv);
      this._headerSent = true;
    }
    this.push(this._cipher.update(chunk));
    cb();
  }

  _flush(cb) {
    this.push(this._cipher.final());
    this.push(this._cipher.getAuthTag()); // 16-byte GCM tag
    cb();
  }
}

// ─── Decrypt Transform Stream ─────────────────────────────────────────────────
// Input: [IV][ciphertext][auth tag] — outputs plaintext
// Note: GCM tag verification happens at stream end
class DecryptStream extends Transform {
  constructor(key) {
    super();
    this._key = key;
    this._buffer = Buffer.alloc(0);
    this._decipher = null;
    this._ivRead = false;
  }

  _transform(chunk, _enc, cb) {
    this._buffer = Buffer.concat([this._buffer, chunk]);

    if (!this._ivRead && this._buffer.length >= IV_LENGTH) {
      const iv = this._buffer.slice(0, IV_LENGTH);
      this._buffer = this._buffer.slice(IV_LENGTH);
      this._decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv);
      this._ivRead = true;
    }

    if (this._decipher && this._buffer.length > TAG_LENGTH) {
      const toDecrypt = this._buffer.slice(0, this._buffer.length - TAG_LENGTH);
      this._buffer = this._buffer.slice(this._buffer.length - TAG_LENGTH);
      this.push(this._decipher.update(toDecrypt));
    }
    cb();
  }

  _flush(cb) {
    if (!this._decipher) return cb(new Error('No data'));
    try {
      this._decipher.setAuthTag(this._buffer); // last 16 bytes = tag
      this.push(this._decipher.final());       // throws if tag invalid
      cb();
    } catch (err) {
      cb(new Error('Decryption failed: auth tag mismatch'));
    }
  }
}

// ─── Generate encryption metadata for a download response ────────────────────
// Returns headers to send to the receiver so they can decrypt
function generateEncryptionHeaders(shareId, filePath) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const { key, salt } = deriveKey(shareId, filePath, nonce);
  return {
    key,
    headers: {
      'X-Encryption-Algo': 'AES-256-GCM',
      'X-Encryption-Nonce': nonce,
      'X-Encryption-Salt': salt,
      'X-Encryption-IV-Length': String(IV_LENGTH),
      'X-Encryption-Tag-Length': String(TAG_LENGTH)
    },
    // Also return key as base64url for the client
    keyB64: key.toString('base64url')
  };
}

const isEnabled = () => process.env.ENCRYPTION_ENABLED === 'true';

module.exports = {
  EncryptStream,
  DecryptStream,
  generateEncryptionHeaders,
  deriveKey,
  deriveKeyFromSalt,
  isEnabled
};
