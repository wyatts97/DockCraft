/**
 * console.js (route) — send console commands + fetch recent logs.
 *
 * Live log streaming is handled over Socket.io (see index.js / realtime). This
 * route covers the request/response bits: sending a command and the initial
 * backlog of log lines when the console page loads.
 */

const express = require('express');
const docker = require('../docker');
const { ok, fail } = require('../middleware/auth');

const router = express.Router();

/** POST /api/console/command — { command } */
router.post('/command', async (req, res) => {
  const { command } = req.body || {};
  if (!command || !command.trim()) return fail(res, 'A command is required.', 400);
  try {
    const output = await docker.sendCommand(command.trim());
    return ok(res, { command: command.trim(), output: docker.stripControl(output || '') });
  } catch (err) {
    const code = err.code || (err instanceof docker.DockerUnavailableError ? 503 : 500);
    return fail(res, err.message, code);
  }
});

/** GET /api/console/logs?tail=200 — initial backlog */
router.get('/logs', async (req, res) => {
  const tail = Math.min(parseInt(req.query.tail, 10) || 200, 1000);
  try {
    const lines = await docker.recentLogs({ tail });
    return ok(res, { lines });
  } catch (err) {
    if (err.code === 404) return ok(res, { lines: [] });
    const code = err instanceof docker.DockerUnavailableError ? 503 : 500;
    return fail(res, err.message, code);
  }
});

module.exports = router;
