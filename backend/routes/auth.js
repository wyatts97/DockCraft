/**
 * auth.js (route) — login + setup-status + bootstrap of the admin account.
 *
 * These routes are mounted BEFORE the requireAuth guard in index.js so the
 * first-run wizard can create the admin account and log in.
 *
 * /api/auth/password is mounted UNDER the guard (see index.js) so only an
 * authenticated admin can rotate their own password.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { ok, fail, signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

/** GET /api/auth/status — does the app need first-run setup? */
router.get('/status', (req, res) => {
  const cfg = config.load();
  return ok(res, {
    setupComplete: cfg.setupComplete && !!cfg.admin.passwordHash,
    hasAdmin: !!cfg.admin.passwordHash,
  });
});

/** POST /api/auth/login — { username, password } -> { token, username } */
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, 'Username and password are required.', 400);

  const cfg = config.load();
  if (!cfg.admin.passwordHash) {
    return fail(res, 'No admin account exists yet. Complete setup first.', 403);
  }
  if (username !== cfg.admin.username) {
    return fail(res, 'Invalid username or password.', 401);
  }
  const match = await bcrypt.compare(password, cfg.admin.passwordHash);
  if (!match) return fail(res, 'Invalid username or password.', 401);

  const token = signToken({ sub: username });
  return ok(res, { token, username });
});

/** POST /api/auth/password — { currentPassword, newPassword }
 *  Rotate the admin's password. Requires the current password (defence in
 *  depth in case a stolen session is in use). */
router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return fail(res, 'Both current and new passwords are required.', 400);
  }
  if (String(newPassword).length < 6) {
    return fail(res, 'New password must be at least 6 characters.', 400);
  }
  const cfg = config.load();
  if (!cfg.admin.passwordHash) {
    return fail(res, 'No admin account exists yet.', 400);
  }
  const match = await bcrypt.compare(currentPassword, cfg.admin.passwordHash);
  if (!match) return fail(res, 'Current password is incorrect.', 403);

  const newHash = await bcrypt.hash(newPassword, 10);
  config.update({ admin: { ...cfg.admin, passwordHash: newHash } });
  return ok(res, { changed: true });
});

module.exports = router;
