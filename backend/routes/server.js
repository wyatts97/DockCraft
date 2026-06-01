/**
 * server.js (route) — Minecraft container lifecycle + status.
 */

const express = require('express');
const docker = require('../docker');
const logParser = require('../services/logParser');
const { ok, fail } = require('../middleware/auth');

const router = express.Router();

function handleDockerError(res, err) {
  const code = err.code || (err instanceof docker.DockerUnavailableError ? 503 : 500);
  return fail(res, err.message, code);
}

/** GET /api/server/status */
router.get('/status', async (req, res) => {
  try {
    const s = await docker.status();
    return ok(res, {
      ...s,
      playerCount: logParser.getOnlinePlayers().length,
      version: logParser.version,
    });
  } catch (err) {
    // A missing container ("not set up yet") or an unreachable daemon are both
    // normal states for the dashboard's status poll — report them gracefully
    // rather than erroring every 10 seconds.
    const isUnavailable = err instanceof docker.DockerUnavailableError || err.code === 503;
    if (err.code === 404 || isUnavailable) {
      return ok(res, {
        running: false,
        state: err.code === 404 ? 'absent' : 'unreachable',
        startedAt: null,
        uptimeSeconds: 0,
        cpu: 0,
        memory: 0,
        playerCount: 0,
        version: null,
      });
    }
    return handleDockerError(res, err);
  }
});

/** POST /api/server/start */
router.post('/start', async (req, res) => {
  try {
    await docker.start();
    return ok(res, { state: 'starting' });
  } catch (err) {
    return handleDockerError(res, err);
  }
});

/** POST /api/server/stop */
router.post('/stop', async (req, res) => {
  try {
    await docker.stop();
    logParser.reset();
    return ok(res, { state: 'stopping' });
  } catch (err) {
    return handleDockerError(res, err);
  }
});

/** POST /api/server/restart */
router.post('/restart', async (req, res) => {
  try {
    await docker.restart();
    logParser.reset();
    return ok(res, { state: 'restarting' });
  } catch (err) {
    return handleDockerError(res, err);
  }
});

module.exports = router;
