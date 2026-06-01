/**
 * security.js — shared security helpers for the DockCraft backend.
 *
 *  - SSRF guard: validateFetchUrl() — blocks http://, private/loopback/link-local
 *    IPs, and redirects that escape to those ranges. Use this on every
 *    user-supplied URL the server fetches.
 *  - socketAuth: Socket.io middleware that verifies the JWT on the connection
 *    handshake. Mounted by realtime.js.
 *  - sanitizeError(): produce a client-safe error string. Internal error
 *    messages (Docker socket paths, file system paths, stack traces) are
 *    stripped so they never reach the browser.
 *  - rateLimiters: pre-configured express-rate-limit instances for the auth
 *    surface (login, setup) and a general "expensive" limiter.
 */

const dns = require('dns').promises;
const net = require('net');
const jwt = require('jsonwebtoken');
const config = require('./config');

/* ---------------- SSRF guard ---------------- */

/**
 * Returns true if the address belongs to a range we must never let the
 * backend connect to: loopback (127/8, ::1), private (10/8, 172.16/12,
 * 192.168/16, fc00::/7), link-local (169.254/16, fe80::/10), the CGNAT range
 * (100.64/10), or unspecified (0.0.0.0). Cloud metadata endpoints live in
 * 169.254.169.254 so they're caught by the link-local check.
 */
function isBlockedAddress(ip) {
  if (!ip) return true;
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 127) return true;                       // loopback
    if (a === 10) return true;                        // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;          // private
    if (a === 169 && b === 254) return true;          // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0) return true;                         // unspecified
    if (a >= 224) return true;                        // multicast / reserved
  } else if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;       // loopback / unspecified
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
        lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  }
  return false;
}

/**
 * Validate that a URL is safe for the server to fetch. Returns the parsed
 * URL object if acceptable, throws an Error otherwise. Resolves the hostname
 * to ensure the IP address itself isn't in a blocked range.
 *
 * Note: this is best-effort. DNS rebinding can still occur between validation
 * and fetch; for stronger protection pair this with a custom Agent that pins
 * the resolved IP, or run the backend with a network namespace.
 */
async function validateFetchUrl(input, { allowHttp = false } = {}) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Invalid URL.'); }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error('Only https URLs are allowed.');
  }
  if (!url.hostname) throw new Error('URL has no hostname.');

  // Resolve all addresses and check every one — a hostname with a mix of
  // public and private addresses is still a threat.
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve hostname: ${url.hostname}`);
  }
  if (!addresses.length) throw new Error(`Could not resolve hostname: ${url.hostname}`);
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error('URL points to a private or reserved address.');
    }
  }
  return url;
}

/** Like fetch, but re-validates the host on every redirect hop. */
async function safeFetch(url, options = {}, { allowHttp = false, maxRedirects = 5 } = {}) {
  let current = await validateFetchUrl(url, { allowHttp });
  for (let i = 0; i <= maxRedirects; i += 1) {
    const response = await fetch(current, { ...options, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc) return response;
      // Re-validate the redirect target (it can be a different host).
      const next = new URL(loc, current);
      current = await validateFetchUrl(next, { allowHttp });
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects.');
}

/* ---------------- Socket.io auth ---------------- */

/**
 * Express middleware for HTTP. Socket.io wraps it in `socket.use(middleware)`.
 * On failure we pass an Error to next(); the handshake is rejected.
 */
function socketAuth(socket, next) {
  try {
    const cfg = config.load();
    if (!cfg.setupComplete || !cfg.admin.passwordHash) {
      return next(new Error('Setup not complete.'));
    }
    // The browser sends the token in the `auth` payload (recommended by
    // socket.io) — fall back to a query param for older clients.
    const token =
      (socket.handshake.auth && socket.handshake.auth.token) ||
      socket.handshake.query?.token ||
      '';
    if (!token) return next(new Error('Authentication required.'));
    socket.user = jwt.verify(token, cfg.jwtSecret);
    return next();
  } catch {
    return next(new Error('Invalid or expired token.'));
  }
}

/* ---------------- Error sanitization ---------------- */

/**
 * The internal error handler uses this to decide what to show the client.
 * Known-safe messages (from our own fail() calls, plain Error objects with
 * short messages) are returned as-is. Anything that smells internal
 * (Docker socket path, ENOENT, stack trace, port number) is replaced with a
 * generic message; the real cause is still logged server-side.
 */
function sanitizeError(err) {
  if (!err) return 'Internal server error.';
  const raw = String(err.message || err);
  if (!raw) return 'Internal server error.';
  // Strip filesystem paths that look like internal state.
  if (/[/\\](var|tmp|app|root|home|Users|node_modules)[/\\]/i.test(raw)) {
    return 'An internal error occurred.';
  }
  if (/ENOENT|EACCES|EPERM|EADDRINUSE|ECONNREFUSED|unix:\/\//i.test(raw)) {
    return 'An internal error occurred.';
  }
  // Cap length so we never echo huge stack traces.
  const trimmed = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  return trimmed;
}

/* ---------------- Rate limiters ---------------- */

// Lazy require so tests / non-server contexts can stub the package if needed.
let _rateLimit;
function rateLimit(opts) {
  if (!_rateLimit) _rateLimit = require('express-rate-limit');
  return _rateLimit(opts);
}

/** Strict limiter for login & setup — 10 attempts per 15 minutes per IP. */
function authRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: 'Too many attempts. Please try again later.' },
  });
}

/** Looser limiter for the rest of the API — protects against accidental
 *  tight loops in the UI. */
function apiRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Slow down.' },
  });
}

module.exports = {
  isBlockedAddress,
  validateFetchUrl,
  safeFetch,
  socketAuth,
  sanitizeError,
  authRateLimiter,
  apiRateLimiter,
};
