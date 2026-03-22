# NullShare v2.0 — Complete Debugging & Testing Guide

## 🚀 Quick Start (Verified Working)

```bash
# 1. Navigate to project
cd c:\Users\syedh\OneDrive\Desktop\NULLSHARE\nullshare_v2_complete\nullshare

# 2. Run the launcher (auto-generates JWT, installs deps, starts server)
start.bat

# 3. Open dashboard
http://localhost:3000
```

---

## ✅ Full System Workflow (Step-by-Step)

### Step 1: Create a Share (Sharer Dashboard)

**UI:** http://localhost:3000
- Fill in folder path: `C:\Users\syedh\Documents` (or any folder)
- Label: "Test Share"
- Permission: "Download Enabled"
- Expiry: "24 hours"
- Password: "test123"
- Click "Generate Share Link"

**Expected Response:**
```json
{
  "shareId": "550e8400-e29b-41d4-a716-446655440000",
  "token": "base64url_encoded_token_here",
  "shareUrl": "http://localhost:3000/share/base64url_encoded_token_here",
  "label": "Test Share",
  "permission": "download",
  "expiresAt": 1704153600000,
  "passwordProtected": true,
  "ipRestricted": false,
  "qrCode": "data:image/png;base64,...",
  "scan": {
    "status": "clean",
    "message": "No threats found."
  }
}
```

**What happens:**
- ✅ Share created in SQLite database
- ✅ Token generated (256-bit random)
- ✅ Password hashed with bcrypt
- ✅ QR code generated
- ✅ Malware scan run (if enabled)
- ✅ Logged to access_logs table

---

### Step 2: Access Share (Receiver)

**UI:** Click the share URL or visit:
```
http://localhost:3000/share/base64url_encoded_token_here
```

**Expected:** Auth screen appears asking for password

---

### Step 3: Authenticate (Receiver)

**API Call:**
```bash
curl -X POST http://localhost:3000/api/access/TOKEN/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"test123"}'
```

**Expected Response:**
```json
{
  "sessionToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "permission": "download",
  "label": "Test Share",
  "expiresAt": 1704153600000
}
```

**What happens:**
- ✅ Password verified against bcrypt hash
- ✅ JWT issued (expires in 24h or when share expires)
- ✅ Auth logged to access_logs
- ✅ Session token returned to receiver

---

### Step 4: Browse Files (Receiver)

**API Call:**
```bash
curl http://localhost:3000/api/access/TOKEN/files?path= \
  -H "Authorization: Bearer SESSION_JWT"
```

**Expected Response:**
```json
{
  "path": "/",
  "entries": [
    {
      "name": "document.pdf",
      "type": "file",
      "path": "document.pdf",
      "size": 2048576,
      "modified": "2024-01-01T12:00:00.000Z",
      "mimeType": "application/pdf",
      "previewable": true
    },
    {
      "name": "subfolder",
      "type": "directory",
      "path": "subfolder",
      "modified": "2024-01-01T12:00:00.000Z"
    }
  ],
  "permission": "download"
}
```

**What happens:**
- ✅ JWT verified
- ✅ Path sandboxed (no traversal possible)
- ✅ Directory listed (hidden files skipped)
- ✅ File metadata computed
- ✅ Access logged

---

### Step 5: Download File (Receiver)

**API Call:**
```bash
curl http://localhost:3000/api/access/TOKEN/download?path=document.pdf \
  -H "Authorization: Bearer SESSION_JWT" \
  -o document.pdf
```

**Expected:** Binary file stream with headers:
```
Content-Disposition: attachment; filename="document.pdf"
Content-Type: application/pdf
Content-Length: 2048576
Accept-Ranges: bytes
```

**What happens:**
- ✅ JWT verified
- ✅ Download permission checked
- ✅ Path sandboxed
- ✅ File streamed (no memory limit)
- ✅ Range requests supported (resumable downloads)
- ✅ Download logged

---

### Step 6: Preview File (Receiver)

**API Call:**
```bash
curl http://localhost:3000/api/access/TOKEN/preview?path=image.jpg \
  -H "Authorization: Bearer SESSION_JWT"
```

**Expected:** Binary image data with:
```
Content-Disposition: inline; filename="image.jpg"
Content-Type: image/jpeg
```

**What happens:**
- ✅ JWT verified
- ✅ File streamed inline (browser renders it)
- ✅ Works for: images, PDFs, text, audio
- ✅ Preview logged

---

### Step 7: Revoke Share (Sharer Dashboard)

**UI:** Active Shares → Click "Revoke" button

**API Call:**
```bash
curl -X DELETE http://localhost:3000/api/shares/SHARE_ID
```

**Expected Response:**
```json
{
  "success": true
}
```

**What happens:**
- ✅ Share marked as inactive in DB
- ✅ All existing sessions immediately blocked
- ✅ New access attempts return 403

---

## 🔍 Testing All Features

### Test 1: Directory Traversal Protection

**Attack:**
```bash
curl "http://localhost:3000/api/access/TOKEN/files?path=../../etc" \
  -H "Authorization: Bearer SESSION_JWT"
```

**Expected:** 403 Forbidden
```json
{
  "error": "Access denied: Invalid path"
}
```

**Logged as:** `traversal_attempt` with status `denied`

---

### Test 2: Brute Force Protection

**Attack:**
```bash
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/access/TOKEN/auth \
    -H "Content-Type: application/json" \
    -d '{"password":"wrong"}'
done
```

**Expected:** After 10 attempts, 429 Too Many Requests
```json
{
  "error": "Too many authentication attempts. Please try again in 15 minutes."
}
```

---

### Test 3: Expired Share

**Setup:** Create share with `expiresInMinutes: 1`

**Wait:** 61 seconds

**Access:**
```bash
curl http://localhost:3000/api/access/TOKEN/info
```

**Expected:** 404 Not Found
```json
{
  "error": "Share not found"
}
```

---

### Test 4: IP Whitelist

**Setup:** Create share with `allowedIPs: ["192.168.1.10"]`

**Access from different IP:**
```bash
curl -X POST http://localhost:3000/api/access/TOKEN/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"test123"}'
```

**Expected:** 403 Forbidden
```json
{
  "error": "Access denied from your IP address"
}
```

---

### Test 5: View-Only Share

**Setup:** Create share with `permission: "view"`

**Try to download:**
```bash
curl http://localhost:3000/api/access/TOKEN/download?path=file.txt \
  -H "Authorization: Bearer SESSION_JWT"
```

**Expected:** 403 Forbidden
```json
{
  "error": "This share is view-only. Downloads are not permitted.",
  "code": "DOWNLOAD_DENIED"
}
```

---

### Test 6: Malware Scanning

**Setup:** Create share with `scanBeforeShare: true`

**Expected Response:**
```json
{
  "scan": {
    "status": "clean",
    "message": "No threats found."
  }
}
```

**If ClamAV not installed:**
```json
{
  "scan": {
    "status": "skipped",
    "message": "ClamAV not installed. Install for malware scanning."
  }
}
```

---

### Test 7: Signed Download URLs

**API Call:**
```bash
curl -X POST http://localhost:3000/api/shares/SHARE_ID/signed-url \
  -H "Content-Type: application/json" \
  -d '{"filePath":"document.pdf","ttl":300}'
```

**Expected Response:**
```json
{
  "signedUrl": "http://localhost:3000/dl?shareId=550e8400-e29b-41d4-a716-446655440000&path=document.pdf&exp=1704067500&sig=base64url_signature",
  "expiresIn": 300,
  "filePath": "document.pdf"
}
```

**Download via signed URL:**
```bash
curl "http://localhost:3000/dl?shareId=550e8400-e29b-41d4-a716-446655440000&path=document.pdf&exp=1704067500&sig=base64url_signature" \
  -o document.pdf
```

**Expected:** File downloads without Bearer token

---

### Test 8: Live Logs (WebSocket)

**Connect:**
```bash
# Using wscat (npm install -g wscat)
wscat -c ws://localhost:3000/ws/logs
```

**Expected:** Connected message
```json
{
  "type": "connected",
  "message": "NullShare live log stream"
}
```

**Perform any action (auth, download, etc.):**

**Expected:** Real-time log event
```json
{
  "type": "log",
  "data": {
    "id": 1,
    "share_id": "550e8400-e29b-41d4-a716-446655440000",
    "ip_address": "127.0.0.1",
    "user_agent": "curl/7.68.0",
    "action": "download",
    "file_path": "document.pdf",
    "status": "allowed",
    "timestamp": 1704067200000
  }
}
```

---

## 🐛 Troubleshooting

### Issue: "Missing parameters" on /dl endpoint

**Cause:** Query parameters not provided

**Fix:**
```bash
# ❌ Wrong
curl http://localhost:3000/dl

# ✅ Correct
curl "http://localhost:3000/dl?shareId=X&path=Y&exp=T&sig=S"
```

---

### Issue: "Cannot find module 'express'"

**Fix:**
```bash
cd backend
npm install
```

---

### Issue: "Port 3000 already in use"

**Fix (Windows):**
```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

---

### Issue: "JWT_SECRET not set"

**Fix:** Run `start.bat` which auto-generates it

---

### Issue: "Database locked"

**Fix:**
```bash
# Delete WAL files
del data\nullshare.db-shm
del data\nullshare.db-wal
```

---

### Issue: Downloads not working

**Check:**
1. Share has `permission: "download"` ✅
2. JWT is valid (not expired) ✅
3. File path is correct ✅
4. File exists in shared folder ✅

**Debug:**
```bash
# Check share details
curl http://localhost:3000/api/shares/SHARE_ID

# Check logs
curl http://localhost:3000/api/shares/SHARE_ID/logs
```

---

### Issue: Buttons not working in UI

**Check:**
1. Browser console for errors (F12)
2. Network tab to see API calls
3. Check if JWT is being sent in Authorization header

**Debug:**
```javascript
// In browser console
console.log(SESSION_JWT)  // Should show JWT token
console.log(SHARE_PERM)   // Should show 'view' or 'download'
```

---

## 📊 Database Inspection

### View all shares:
```bash
# Using sqlite3 CLI
sqlite3 backend/data/nullshare.db "SELECT id, label, permission, is_active, expires_at FROM shares;"
```

### View recent logs:
```bash
sqlite3 backend/data/nullshare.db "SELECT * FROM access_logs ORDER BY timestamp DESC LIMIT 20;"
```

### View logs for specific share:
```bash
sqlite3 backend/data/nullshare.db "SELECT * FROM access_logs WHERE share_id='SHARE_ID' ORDER BY timestamp DESC;"
```

---

## 🔐 Security Verification

### Verify path sandboxing:
```bash
# This should be BLOCKED
curl "http://localhost:3000/api/access/TOKEN/files?path=../../etc" \
  -H "Authorization: Bearer SESSION_JWT"
# Expected: 403 Forbidden
```

### Verify password hashing:
```bash
# Check database
sqlite3 backend/data/nullshare.db "SELECT password_hash FROM shares WHERE id='SHARE_ID';"
# Should show bcrypt hash (starts with $2b$)
```

### Verify JWT expiry:
```bash
# Decode JWT (use jwt.io or node)
node -e "console.log(require('jsonwebtoken').decode('TOKEN'))"
# Should show exp claim
```

---

## 📈 Performance Testing

### Test with large file:
```bash
# Create 100MB test file
fsutil file createnew test_100mb.bin 104857600

# Share it
# Download it
curl "http://localhost:3000/api/access/TOKEN/download?path=test_100mb.bin" \
  -H "Authorization: Bearer SESSION_JWT" \
  -o downloaded.bin

# Verify integrity
certutil -hashfile test_100mb.bin SHA256
certutil -hashfile downloaded.bin SHA256
# Should match
```

### Test concurrent downloads:
```bash
# Download same file 10 times in parallel
for i in {1..10}; do
  curl "http://localhost:3000/api/access/TOKEN/download?path=file.txt" \
    -H "Authorization: Bearer SESSION_JWT" \
    -o file_$i.txt &
done
wait
```

---

## ✅ Complete Checklist

- [ ] Server starts without errors
- [ ] Dashboard loads at http://localhost:3000
- [ ] Can create share with folder path
- [ ] Share URL works
- [ ] Can authenticate with password
- [ ] Can browse files
- [ ] Can download files
- [ ] Can preview images
- [ ] Can revoke share
- [ ] Live logs update in real-time
- [ ] Directory traversal blocked
- [ ] Brute force protection works
- [ ] Expired shares blocked
- [ ] IP whitelist works
- [ ] View-only shares block downloads
- [ ] Malware scan runs (or skips gracefully)
- [ ] Signed URLs work
- [ ] WebSocket logs work
- [ ] All buttons in UI work
- [ ] No console errors

---

## 🚀 Production Deployment

Before going live:

1. **Set NODE_ENV=production** in .env
2. **Use strong JWT_SECRET** (64+ random chars)
3. **Put behind nginx with TLS**
4. **Restrict dashboard to localhost only**
5. **Enable HTTPS only**
6. **Set up monitoring**
7. **Regular backups**
8. **Keep dependencies updated**

See README.md for full production checklist.

---

**Built with ❤️ by Raihaan Syed (Nullfist) | NullGrids Security | 2025**
