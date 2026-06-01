/**
 * index.js — DockCraft backend entry point.
 *
 * Sets up Express + Socket.io, mounts the API routes, guards everything under
 * /api (except auth + setup) with JWT, serves the built frontend, and starts
 * the real-time log/stats streaming.
 */

require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const docker = require('./docker');
const realtime = require('./realtime');
const { requireAuth, fail } = require('./middleware/auth');

const authRoute = require('./routes/auth');
const setupRoute = require('./routes/setup');
const serverRoute = require('./routes/server');
const consoleRoute = require('./routes/console');
const settingsRoute = require('./routes/settings');
const playersRoute = require('./routes/players');
const worldsRoute = require('./routes/worlds');
const modsRoute = require('./routes/mods');
const marketplaceRoute = require('./routes/marketplace');

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.json({ limit: '2mb' }));

// Simple request logger (no sensitive values).
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[api] ${req.method} ${req.path}`);
  }
  next();
});

// ---- Public routes (no auth) ----
app.get('/api/health', async (req, res) => {
  res.json({ success: true, data: { dockerReachable: await docker.ping() } });
});
app.use('/api/auth', authRoute);
app.use('/api/setup', setupRoute);

// ---- Guarded routes ----
app.use('/api/server', requireAuth, serverRoute);
app.use('/api/console', requireAuth, consoleRoute);
app.use('/api/settings', requireAuth, settingsRoute);
app.use('/api/players', requireAuth, playersRoute);
app.use('/api/worlds', requireAuth, worldsRoute);
app.use('/api/mods', requireAuth, modsRoute);
app.use('/api/marketplace', requireAuth, marketplaceRoute);

// 404 for unknown API routes.
app.use('/api', (req, res) => fail(res, 'Not found.', 404));

// ---- Static frontend (built Adminator output) ----
const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  console.warn(`[static] Frontend build not found at ${FRONTEND_DIST}. Run "npm run build" in frontend/.`);
}

// ---- Centralized error handler ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);
  const status = err.code && Number.isInteger(err.code) ? err.code : 500;
  res.status(status).json({ success: false, error: err.message || 'Internal server error.' });
});

realtime.attach(io);

httpServer.listen(PORT, () => {
  const cfg = config.load();
  console.log(`DockCraft backend listening on http://localhost:${PORT}`);
  console.log(`  Minecraft container: ${cfg.containerName}`);
  console.log(`  Data path:           ${cfg.dataPath}`);
  console.log(`  Setup complete:      ${cfg.setupComplete}`);
});

module.exports = { app, httpServer, io };
