// utils/s3Storage.js
// NullShare — S3 Backend Storage
//
// Optional drop-in replacement for local filesystem storage.
// When S3_ENABLED=true, shared "folders" are S3 prefixes (virtual directories).
//
// Supported operations (mirrors fileSystem.js interface):
//   listDirectory(prefix, rootPrefix) → entries[]
//   streamFile(key, req, res, disposition)
//   isFile(key) → bool
//   isDirectory(prefix) → bool
//
// Config (.env):
//   S3_ENABLED=true
//   S3_BUCKET=my-nullshare-bucket
//   S3_REGION=us-east-1
//   S3_ACCESS_KEY=<access_key>        ← or use IAM role (leave blank)
//   S3_SECRET_KEY=<secret_key>        ← or use IAM role (leave blank)
//   S3_ENDPOINT=https://...           ← optional: for MinIO / R2 / custom S3
//   S3_PATH_STYLE=false               ← set true for MinIO
//
// Share creation with S3:
//   folderPath should be an S3 prefix, e.g. "projects/myproject/"
//   The system treats it as the sandbox root — all access is restricted to it.

const { Readable } = require('stream');

// Lazy-load AWS SDK (only if S3_ENABLED)
let S3Client, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand;

function loadSDK() {
  if (S3Client) return true;
  try {
    const sdk = require('@aws-sdk/client-s3');
    S3Client = sdk.S3Client;
    GetObjectCommand = sdk.GetObjectCommand;
    ListObjectsV2Command = sdk.ListObjectsV2Command;
    HeadObjectCommand = sdk.HeadObjectCommand;
    return true;
  } catch {
    console.error('[S3] @aws-sdk/client-s3 not installed. Run: npm install @aws-sdk/client-s3');
    return false;
  }
}

let _client = null;
function getClient() {
  if (_client) return _client;
  if (!loadSDK()) throw new Error('AWS SDK not available');

  const config = {
    region: process.env.S3_REGION || 'us-east-1',
    credentials: (process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) ? {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY
    } : undefined, // falls back to IAM role / env / ~/.aws/credentials
  };

  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
    config.forcePathStyle = process.env.S3_PATH_STYLE === 'true';
  }

  _client = new S3Client(config);
  return _client;
}

const BUCKET = () => process.env.S3_BUCKET;
const mime = require('mime-types');

// ─── Normalize prefix: always ends with '/' unless empty ─────────────────────
function normalizePrefix(p) {
  if (!p) return '';
  return p.endsWith('/') ? p : p + '/';
}

// ─── Sandbox check: key must start with rootPrefix ───────────────────────────
function assertInSandbox(rootPrefix, key) {
  const root = normalizePrefix(rootPrefix);
  if (!key.startsWith(root)) {
    throw new Error(`TRAVERSAL: Key "${key}" escapes sandbox "${root}"`);
  }
}

// ─── List objects under a prefix (one level deep, like readdir) ───────────────
async function listDirectory(prefix, rootPrefix) {
  const client = getClient();
  const normalizedPrefix = normalizePrefix(prefix);

  const cmd = new ListObjectsV2Command({
    Bucket: BUCKET(),
    Prefix: normalizedPrefix,
    Delimiter: '/'  // virtual directory grouping
  });

  const response = await client.send(cmd);
  const entries = [];

  // "Directories" (common prefixes)
  for (const cp of (response.CommonPrefixes || [])) {
    const name = cp.Prefix.slice(normalizedPrefix.length).replace(/\/$/, '');
    if (!name || name.startsWith('.')) continue;
    const relPath = cp.Prefix.slice(normalizePrefix(rootPrefix).length).replace(/\/$/, '');
    entries.push({ name, path: relPath, type: 'directory', size: null, modified: null, mimeType: null });
  }

  // Files
  for (const obj of (response.Contents || [])) {
    if (obj.Key === normalizedPrefix) continue; // skip the prefix itself
    const name = obj.Key.slice(normalizedPrefix.length);
    if (!name || name.includes('/') || name.startsWith('.')) continue;
    const relPath = obj.Key.slice(normalizePrefix(rootPrefix).length);
    const mimeType = mime.lookup(name) || 'application/octet-stream';
    entries.push({
      name,
      path: relPath,
      type: 'file',
      size: obj.Size,
      modified: obj.LastModified?.toISOString() || null,
      mimeType,
      previewable: isPreviewable(mimeType)
    });
  }

  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─── Stream an S3 object to the response ─────────────────────────────────────
async function streamFile(key, req, res, disposition = 'attachment') {
  const client = getClient();
  const fileName = key.split('/').pop();
  const mimeType = mime.lookup(fileName) || 'application/octet-stream';

  // Handle Range requests
  const rangeHeader = req.headers['range'];
  const cmdParams = { Bucket: BUCKET(), Key: key };
  if (rangeHeader) cmdParams.Range = rangeHeader;

  try {
    const response = await client.send(new GetObjectCommand(cmdParams));
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    if (response.ContentLength) res.setHeader('Content-Length', response.ContentLength);
    if (response.ContentRange) res.setHeader('Content-Range', response.ContentRange);

    res.status(rangeHeader ? 206 : 200);

    // response.Body is a ReadableStream (Web Streams API) — convert to Node stream
    const nodeStream = Readable.fromWeb ? Readable.fromWeb(response.Body) : response.Body;
    nodeStream.pipe(res);
    nodeStream.on('error', () => res.end());
  } catch (err) {
    if (err.name === 'NoSuchKey') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: 'S3 stream error' });
  }
}

// ─── Check if a key is a file (exists and is not a prefix) ───────────────────
async function isFile(key) {
  try {
    const client = getClient();
    await client.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

// ─── Check if a prefix has any objects (acts as directory) ───────────────────
async function isDirectory(prefix) {
  try {
    const client = getClient();
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET(),
      Prefix: normalizePrefix(prefix),
      MaxKeys: 1
    }));
    return (res.Contents?.length > 0) || (res.CommonPrefixes?.length > 0);
  } catch {
    return false;
  }
}

// ─── Resolve a relative path within an S3 sandbox ────────────────────────────
// Equivalent to security.js safePath() but for S3 keys
function safePath(rootPrefix, requestedPath) {
  const root = normalizePrefix(rootPrefix);
  // Reject null bytes and traversal patterns
  if (!requestedPath) return root.replace(/\/$/, '');
  if (requestedPath.includes('\0')) throw new Error('TRAVERSAL: Null byte');
  // Decode and normalize
  let clean;
  try { clean = decodeURIComponent(requestedPath); } catch { throw new Error('TRAVERSAL: Invalid encoding'); }
  if (clean.includes('\0')) throw new Error('TRAVERSAL: Null byte after decode');
  // Normalize path separators and collapse ..
  const parts = clean.replace(/\\/g, '/').split('/').filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === '..') throw new Error('TRAVERSAL: Parent directory reference');
    if (part !== '.') resolved.push(part);
  }
  const fullKey = root + resolved.join('/');
  if (!fullKey.startsWith(root)) throw new Error('TRAVERSAL: Escapes sandbox');
  return fullKey;
}

function isPreviewable(mimeType) {
  return ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
    'application/pdf','text/plain','text/markdown','text/csv',
    'video/mp4','video/webm','audio/mpeg','audio/wav','audio/ogg'].includes(mimeType);
}

const isEnabled = () => process.env.S3_ENABLED === 'true';

module.exports = { listDirectory, streamFile, isFile, isDirectory, safePath, isEnabled, assertInSandbox };
