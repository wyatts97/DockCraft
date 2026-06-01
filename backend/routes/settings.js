/**
 * settings.js (route) — read/update Minecraft server settings (env vars).
 *
 * Per AGENTS.md we NEVER edit server.properties directly. Settings are stored
 * as environment variables in dockcraft.config.json and applied to the
 * container. Because env vars are immutable on a running container, a PUT
 * recreates the container with the new env (docker.recreate) — surfaced in the
 * UI as "Save & Restart".
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const docker = require('../docker');
const { ok, fail } = require('../middleware/auth');

const router = express.Router();
const SCHEMA_PATH = path.join(__dirname, '..', 'schema', 'property-definitions.json');

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

/** Set of env keys the schema knows about (the only keys we accept on PUT). */
function knownKeys() {
  const schema = loadSchema();
  const keys = new Set();
  for (const group of schema.groups) {
    for (const field of group.fields) keys.add(field.key);
  }
  return keys;
}

/** GET /api/settings — current env values */
router.get('/', (req, res) => {
  return ok(res, { env: config.load().env });
});

/** GET /api/settings/schema — grouped, labeled field definitions */
router.get('/schema', (req, res) => {
  try {
    return ok(res, loadSchema());
  } catch (err) {
    return fail(res, 'Failed to load settings schema.', 500);
  }
});

/** PUT /api/settings — key/value env map; recreates the container to apply */
router.put('/', async (req, res) => {
  const incoming = req.body || {};
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return fail(res, 'Expected a key/value object of settings.', 400);
  }

  const allowed = knownKeys();
  const patch = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (allowed.has(key)) patch[key] = String(value);
  }
  if (Object.keys(patch).length === 0) {
    return fail(res, 'No recognized settings were provided.', 400);
  }

  const cfg = config.setEnv(patch);

  // Apply by recreating the container. If it doesn't exist yet, that's fine —
  // settings are saved and will apply on first start.
  try {
    await docker.inspect();
    await docker.recreate(cfg.env);
    return ok(res, { env: cfg.env, applied: true });
  } catch (err) {
    if (err.code === 404) {
      return ok(res, { env: cfg.env, applied: false, note: 'Saved. Will apply when the server is created.' });
    }
    return fail(res, `Saved settings, but failed to restart the server: ${err.message}`, 503);
  }
});

module.exports = router;
