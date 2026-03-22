// utils/fileSystem.js
// NullShare - File system helpers
// Handles directory indexing, file metadata, and streaming

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

/**
 * Get a flat listing of a single directory (non-recursive)
 * Returns entries sorted: folders first, then files alphabetically
 * 
 * @param {string} dirPath - Absolute path to directory
 * @param {string} rootDir - The share root (for computing relative paths)
 * @returns {Object[]} Array of file/dir metadata objects
 */
function listDirectory(dirPath, rootDir) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read directory: ${err.message}`);
  }

  const items = entries
    .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
    .map(entry => {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      
      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        return null; // Skip files we can't stat (permission errors, broken symlinks)
      }

      // SECURITY: Skip symlinks entirely to prevent escaping sandbox
      if (entry.isSymbolicLink()) return null;

      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relPath,
          type: 'directory',
          size: null,
          modified: stats.mtime.toISOString(),
          mimeType: null
        };
      } else if (entry.isFile()) {
        const mimeType = mime.lookup(entry.name) || 'application/octet-stream';
        return {
          name: entry.name,
          path: relPath,
          type: 'file',
          size: stats.size,
          modified: stats.mtime.toISOString(),
          mimeType,
          previewable: isPreviewable(mimeType)
        };
      }
      return null;
    })
    .filter(Boolean); // Remove nulls from skipped entries

  // Sort: directories first, then alphabetical by name
  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Determine if a file can be previewed in-browser
 * Used to show preview buttons in the UI
 */
function isPreviewable(mimeType) {
  const previewable = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'text/plain', 'text/markdown', 'text/csv',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/ogg'
  ];
  return previewable.includes(mimeType);
}

/**
 * Format bytes into human-readable size
 */
function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Stream a file to the response with Range header support
 * This enables:
 * 1. Chunked downloads (browser compatibility)
 * 2. Resume interrupted downloads (Range: bytes=X-)
 * 
 * @param {string} filePath - Absolute path to file
 * @param {Object} req - Express request (for Range header)
 * @param {Object} res - Express response
 * @param {string} disposition - 'inline' (preview) or 'attachment' (download)
 */
function streamFile(filePath, req, res, disposition = 'attachment') {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }

  const fileSize = stats.size;
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  const fileName = path.basename(filePath);

  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes'); // Signal that we support Range requests

  const rangeHeader = req.headers['range'];

  if (rangeHeader) {
    // ── Partial Content (Range Request) ──────────────────────────────────────
    // Handles: "Range: bytes=1024-" or "Range: bytes=1024-2048"
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    
    // Validate range
    if (start >= fileSize || end >= fileSize || start > end) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).send('Range Not Satisfiable');
    }

    const chunkSize = end - start + 1;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    res.status(206); // Partial Content

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    stream.on('error', () => res.end());
  } else {
    // ── Full File ────────────────────────────────────────────────────────────
    res.setHeader('Content-Length', fileSize);
    res.status(200);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => res.end());
  }
}

/**
 * Check if a path is a file (not directory)
 */
function isFile(absolutePath) {
  try {
    return fs.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 */
function isDirectory(absolutePath) {
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

module.exports = {
  listDirectory,
  streamFile,
  isFile,
  isDirectory,
  formatSize,
  isPreviewable
};
