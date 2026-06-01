/**
 * setup.js (route) — first-run wizard backend.
 *
 * Creates the admin account, persists the initial server env config, marks
 * setupComplete, and (optionally) starts the Minecraft container. Mounted
 * before the auth guard so it can run on a fresh install.
 *
 * Once setupComplete is true, re-running setup requires authentication and is
 * blocked here to avoid clobbering an existing admin account.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const docker = require('../docker');
const { ok, fail, signToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', async (req, res) => {
  const cfg = config.load();
  if (cfg.setupComplete && cfg.admin.passwordHash) {
    return fail(res, 'Setup has already been completed.', 409);
  }

  const { username, password, server = {}, startServer = true } = req.body || {};
  if (!username || !password) return fail(res, 'Admin username and password are required.', 400);
  if (password.length < 6) return fail(res, 'Password must be at least 6 characters.', 400);

  const env = { ...cfg.env };
  // Whitelisted setup fields mapped onto container env vars.
  const map = {
    serverName: 'SERVER_NAME',
    gamemode: 'GAMEMODE',
    difficulty: 'DIFFICULTY',
    maxPlayers: 'MAX_PLAYERS',
    port: 'SERVER_PORT',
    onlineMode: 'ONLINE_MODE',
    allowList: 'ALLOW_LIST',
    levelName: 'LEVEL_NAME',
    levelSeed: 'LEVEL_SEED',
  };
  for (const [field, envKey] of Object.entries(map)) {
    if (server[field] !== undefined && server[field] !== null && server[field] !== '') {
      env[envKey] = String(server[field]);
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  config.update({
    setupComplete: true,
    admin: { username, passwordHash },
    env,
  });

  let started = false;
  let startError = null;
  if (startServer) {
    try {
      await docker.start();
      started = true;
    } catch (err) {
      startError = err.message; // surface but don't fail setup
    }
  }

  const token = signToken({ sub: username });
  return ok(res, { token, username, started, startError });
});

module.exports = router;
