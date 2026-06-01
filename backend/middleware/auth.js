/**
 * auth.js — JWT verification middleware + response helpers.
 *
 * The token is issued by the /api/auth/login route and stored client-side in
 * localStorage. The frontend sends it as `Authorization: Bearer <token>`.
 *
 * Setup and auth routes are exempt (handled in index.js) so the first-run
 * wizard can run before any admin account exists.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function fail(res, message, status = 400, data) {
  const body = { success: false, error: message };
  if (data !== undefined) body.data = data;
  return res.status(status).json(body);
}

function signToken(payload) {
  return jwt.sign(payload, config.load().jwtSecret, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const cfg = config.load();
  // If setup hasn't completed there's no admin account yet — let the frontend
  // route the user to the wizard rather than hard-blocking the API.
  if (!cfg.setupComplete || !cfg.admin.passwordHash) {
    return fail(res, 'Setup not complete.', 403);
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'Authentication required.', 401);
  try {
    req.user = jwt.verify(token, cfg.jwtSecret);
    return next();
  } catch {
    return fail(res, 'Session expired. Please sign in again.', 401);
  }
}

module.exports = { ok, fail, signToken, requireAuth };
