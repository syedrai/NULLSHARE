// db/database.js — NullShare v2 (with live broadcast hook)
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'nullshare.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id          TEXT PRIMARY KEY,
    token       TEXT UNIQUE NOT NULL,
    folder_path TEXT NOT NULL,
    label       TEXT,
    password_hash TEXT,
    permission  TEXT NOT NULL DEFAULT 'view',
    expires_at  INTEGER,
    ip_whitelist TEXT,
    created_at  INTEGER NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS access_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id    TEXT NOT NULL,
    ip_address  TEXT NOT NULL,
    user_agent  TEXT,
    action      TEXT NOT NULL,
    file_path   TEXT,
    status      TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    FOREIGN KEY (share_id) REFERENCES shares(id)
  );
  CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
  CREATE INDEX IF NOT EXISTS idx_logs_share   ON access_logs(share_id);
  CREATE INDEX IF NOT EXISTS idx_logs_time    ON access_logs(timestamp);
`);

const createShare       = db.prepare(`INSERT INTO shares (id,token,folder_path,label,password_hash,permission,expires_at,ip_whitelist,created_at) VALUES (@id,@token,@folder_path,@label,@password_hash,@permission,@expires_at,@ip_whitelist,@created_at)`);
const getShareByToken   = db.prepare(`SELECT * FROM shares WHERE token=? AND is_active=1`);
const getShareById      = db.prepare(`SELECT * FROM shares WHERE id=?`);
const revokeShare       = db.prepare(`UPDATE shares SET is_active=0 WHERE id=?`);
const listShares        = db.prepare(`SELECT id,token,label,folder_path,permission,expires_at,created_at,is_active,password_hash FROM shares ORDER BY created_at DESC`);
const _logAccess        = db.prepare(`INSERT INTO access_logs (share_id,ip_address,user_agent,action,file_path,status,timestamp) VALUES (@share_id,@ip_address,@user_agent,@action,@file_path,@status,@timestamp)`);
const getLogsForShare   = db.prepare(`SELECT * FROM access_logs WHERE share_id=? ORDER BY timestamp DESC LIMIT 200`);
const getRecentLogs     = db.prepare(`SELECT l.*,s.label,s.token FROM access_logs l JOIN shares s ON l.share_id=s.id ORDER BY l.timestamp DESC LIMIT 500`);

// ─── logAccess wrapper: write to DB + broadcast to WS clients ────────────────
// We lazy-import logBroadcaster to avoid circular dependency at startup
function logAccess(entry) {
  _logAccess.run(entry);
  // Broadcast to live dashboard (fire-and-forget, non-blocking)
  try {
    const { broadcast } = require('../utils/logBroadcaster');
    broadcast({ ...entry, id: db.prepare('SELECT last_insert_rowid() as id').get()['last_insert_rowid()'] });
  } catch {}
}
// Expose as .run() to match better-sqlite3 interface used in routes
logAccess.run = logAccess;

module.exports = { db, createShare, getShareByToken, getShareById, revokeShare, listShares, logAccess, getLogsForShare, getRecentLogs };
