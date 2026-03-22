// utils/logBroadcaster.js
// NullShare — Real-Time Log Broadcasting via WebSocket
//
// How it works:
//   1. server.js creates a WebSocket server attached to the HTTP server
//   2. Dashboard clients connect via ws://localhost:3000/ws/logs
//   3. Every time logAccess() is called, we also call broadcast()
//   4. All connected dashboard clients receive the log event instantly
//
// This is a one-way push channel (server → clients only).
// No auth on WS in dev mode — in prod, put it behind nginx localhost-only.

const { WebSocketServer } = require('ws');

// ─── Module State ─────────────────────────────────────────────────────────────
let wss = null;  // The WebSocket server instance

/**
 * Attach a WebSocket server to an existing HTTP server
 * Called once from server.js after app.listen()
 *
 * @param {http.Server} httpServer - The Node HTTP server
 */
function attachWebSocketServer(httpServer) {
  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws/logs'  // Only handle connections on this path
  });

  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    console.log(`[WS] Dashboard connected from ${clientIP}`);

    // Send a welcome ping so the client knows connection is live
    ws.send(JSON.stringify({ type: 'connected', message: 'NullShare live log stream' }));

    ws.on('close', () => {
      console.log(`[WS] Dashboard disconnected from ${clientIP}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error: ${err.message}`);
    });
  });

  console.log('[WS] Live log WebSocket server attached at /ws/logs');
}

/**
 * Broadcast a log event to ALL connected dashboard clients
 * Called from the logAccess wrapper below
 *
 * @param {Object} logEntry - The log data to send
 */
function broadcast(logEntry) {
  if (!wss) return;  // Not initialized yet

  const payload = JSON.stringify({
    type: 'log',
    data: logEntry
  });

  let sent = 0;
  wss.clients.forEach(client => {
    // readyState 1 = OPEN
    if (client.readyState === 1) {
      client.send(payload);
      sent++;
    }
  });
}

/**
 * Get count of connected dashboard clients
 */
function getConnectedCount() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach(c => { if (c.readyState === 1) count++; });
  return count;
}

module.exports = { attachWebSocketServer, broadcast, getConnectedCount };
