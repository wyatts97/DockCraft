/**
 * index.js — DockCraft backend entry point.
 *
 * Sets up Express + Socket.io, mounts the API routes, guards everything under
 * /api (except auth + setup) with JWT, serves the built frontend, and starts
 * the real-time log/stats streaming.
 *
 * Security middleware (helmet, rate limit, payload limit, SSRF-aware fetch
 * helpers, sanitized error responses, Socket.io auth) lives in ./security.
 */

require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');

const config = require('./config');
const docker = require('./docker');
const realtime = require('./realtime');
const { requireAuth, fail } = require('./middleware/auth');
const { authRateLimiter, apiRateLimiter, sanitizeError, socketAuth } = require('./security');

const authRoute = require('./routes/auth');
const setupRoute = require('./routes/setup');
const serverRoute = require('./routes/server');
const consoleRoute = require('./routes/console');
const settingsRoute = require('./routes/settings');
const playersRoute = require('./routes/players');
const worldsRoute = require('./routes/worlds');
const modsRoute = require('./routes/mods');
const marketplaceRoute = require('./routes/marketplace');
const systemRoute = require('./routes/system');

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);

// Security headers. We explicitly allow inline <script> for the pre-paint
// theme bootstrap that lives in every HTML page, plus the Adminator bundle's
// own inline styles. A stricter CSP would require bundling those as external
// files — tracked as a follow-up.
app.use(
  helmet({
    // HSTS is OFF by default. Helmet v7 enables it with a 180-day maxAge, and
    // modern browsers honor HSTS even when received over HTTP (to prevent
    // downgrade attacks). That means a single hit to an HTTP-only deployment
    // (no TLS in front of the backend) caches a rule that upgrades every
    // future request to HTTPS — the assets then fail with ERR_SSL_PROTOCOL_ERROR
    // and the page renders unstyled. Opt back in with HELMET_HSTS=1 when the
    // backend is behind a terminating TLS proxy.
    hsts: process.env.HELMET_HSTS === '1',
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        // Inline <script> in the pre-paint theme bootstrap and any
        // generated inline styles from the design system. Remove 'unsafe-eval'
        // to harden further; Adminator's dynamic color-mix usage is safe.
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        // Socket.io needs to connect back to the same origin; nothing else
        // is allowed to phone home.
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'img-src': ["'self'", 'data:', 'https:'],
        // The marketplace description HTML can include CurseForge embeds.
        'frame-src': ["'self'", 'https://www.curseforge.com', 'https://*.curseforge.com'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        // The `upgrade-insecure-requests` directive (added by helmet's
        // useDefaults) would tell the browser to silently rewrite every
        // http:// subresource to https:// — which fails (ERR_SSL_PROTOCOL_ERROR)
        // on an HTTP-only deployment and leaves the page unstyled. Drop it.
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false, // CurseForge thumbnails need to load
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

// Cap JSON bodies. Multipart uploads are bounded separately by multer.
app.use(express.json({ limit: '512kb' }));

// Simple request logger (no sensitive values).
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[api] ${req.method} ${req.path}`);
  }
  next();
});

// ---- Public routes (no auth, no rate limit other than the global one) ----
app.get('/api/health', async (req, res) => {
  res.json({ success: true, data: { dockerReachable: await docker.ping() } });
});
app.use('/api/auth', authRateLimiter(), authRoute);
app.use('/api/setup', authRateLimiter(), setupRoute);
app.use('/api/system', systemRoute);

// ---- Guarded routes (JWT + global API rate limit) ----
app.use('/api', apiRateLimiter());
app.use('/api/server', requireAuth, serverRoute);
app.use('/api/console', requireAuth, consoleRoute);
app.use('/api/settings', requireAuth, settingsRoute);
app.use('/api/players', requireAuth, playersRoute);
app.use('/api/worlds', requireAuth, worldsRoute);
app.use('/api/mods', requireAuth, modsRoute);
app.use('/api/marketplace', requireAuth, marketplaceRoute);

// 404 for unknown API routes.
app.use('/api', (req, res) => fail(res, 'Not found.', 404));

// Favicon — the real DockCraft .ico (multi-resolution: 16/24/32/48/64/96/128/256,
// 32bpp). Browsers pick the size they need; we serve the same file at both
// /favicon.ico (legacy convention) and /assets/static/images/dockcraft.ico
// (the path linked from the HTML <head>).
//
// We look for the .ico in the dist bundle first; if the frontend hasn't been
// built yet, fall back to a 1x1 transparent PNG so the page never 404s.
const faviconCandidates = [
  path.join(__dirname, '..', 'frontend', 'dist', 'assets', 'static', 'images', 'dockcraft.ico'),
  path.join(__dirname, '..', 'frontend', 'src', 'assets', 'static', 'images', 'dockcraft.ico'),
];
const faviconPath = faviconCandidates.find((p) => fs.existsSync(p));
if (faviconPath) {
  app.get('/favicon.ico', (_req, res) => {
    res.set('Content-Type', 'image/x-icon');
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(faviconPath);
  });
} else {
  // Pre-build fallback — 1x1 transparent PNG.
  app.get('/favicon.ico', (_req, res) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
  });
}

// ---- Static frontend (built Adminator output) ----
const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // The PWA web manifest is at /assets/static/site.webmanifest in the build
  // output (CopyWebpackPlugin copies assets/static/ wholesale), but the
  // canonical path expected by browsers is /site.webmanifest. Serve it at
  // the root with the correct content type so the <link rel="manifest">
  // in each page finds it.
  const webmanifestPath = path.join(FRONTEND_DIST, 'assets', 'static', 'site.webmanifest');
  if (fs.existsSync(webmanifestPath)) {
    app.get('/site.webmanifest', (_req, res) => {
      res.set('Content-Type', 'application/manifest+json');
      res.set('Cache-Control', 'public, max-age=3600');
      res.sendFile(webmanifestPath);
    });
  }
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
} else {
  console.warn(`[static] Frontend build not found at ${FRONTEND_DIST}. Run "npm run build" in frontend/.`);
}

// ---- Centralized error handler ----
// Sanitizes messages so internal details (Docker socket paths, ENOENT, etc.)
// never reach the browser. Real cause is still logged server-side above.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[error] ${req.method} ${req.path}:`, err);
  const status = err.code && Number.isInteger(err.code) ? err.code : 500;
  res.status(status).json({ success: false, error: sanitizeError(err) });
});

// Socket.io: bind auth middleware so unauthenticated clients can't subscribe
// to console / player / stats events. CORS is locked down to same-origin in
// production; '*' is fine because we still require a valid JWT on connect.
const io = new Server(httpServer, {
  cors: { origin: process.env.NODE_ENV === 'production' ? false : '*' },
});
io.use(socketAuth);

realtime.attach(io);

httpServer.listen(PORT, () => {
  const cfg = config.load();
  console.log(`DockCraft backend listening on http://localhost:${PORT}`);
  console.log(`  Minecraft container: ${cfg.containerName}`);
  console.log(`  Data path:           ${cfg.dataPath}`);
  console.log(`  Setup complete:      ${cfg.setupComplete}`);
});

module.exports = { app, httpServer, io };
