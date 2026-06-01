/**
 * players.js (route) — online players, allowlist, permissions, XUID lookup.
 *
 * Allowlist and permissions are stored as JSON files in /data, matching the
 * Bedrock server formats:
 *   allowlist.json   -> [ { ignoresPlayerLimit, name, xuid } ]
 *   permissions.json -> [ { permission, xuid } ]   permission: operator|member|visitor
 *
 * XUID complexity is hidden from the user: they add a player by gamertag and we
 * resolve the XUID via the lookup service.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logParser = require('../services/logParser');
const xuidLookup = require('../services/xuidLookup');
const { ok, fail } = require('../middleware/auth');

const router = express.Router();

function dataPath() {
  return config.load().dataPath;
}
function allowlistPath() {
  return path.join(dataPath(), 'allowlist.json');
}
function permissionsPath() {
  return path.join(dataPath(), 'permissions.json');
}
function bansPath() {
  return path.join(dataPath(), 'banned-players.json');
}

function readJsonArray(p) {
  try {
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeJsonArray(p, arr) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(arr, null, 2), 'utf8');
}

/** GET /api/players/online */
router.get('/online', (req, res) => {
  return ok(res, { players: logParser.getOnlinePlayers() });
});

/** GET /api/players/xuid/:gamertag */
router.get('/xuid/:gamertag', async (req, res) => {
  try {
    const result = await xuidLookup.lookup(req.params.gamertag);
    return ok(res, result);
  } catch (err) {
    return fail(res, err.message, err.code || 500);
  }
});

/** GET /api/players/allowlist */
router.get('/allowlist', (req, res) => {
  return ok(res, { allowlist: readJsonArray(allowlistPath()) });
});

/** POST /api/players/allowlist — { name, xuid } */
router.post('/allowlist', (req, res) => {
  const { name, xuid } = req.body || {};
  if (!name || !xuid) return fail(res, 'Both name and xuid are required.', 400);
  const list = readJsonArray(allowlistPath());
  if (list.some((p) => p.xuid === String(xuid))) {
    return fail(res, `${name} is already on the allowlist.`, 409);
  }
  list.push({ ignoresPlayerLimit: false, name, xuid: String(xuid) });
  writeJsonArray(allowlistPath(), list);
  return ok(res, { allowlist: list }, 201);
});

/** DELETE /api/players/allowlist/:xuid */
router.delete('/allowlist/:xuid', (req, res) => {
  const xuid = String(req.params.xuid);
  const list = readJsonArray(allowlistPath());
  const next = list.filter((p) => p.xuid !== xuid);
  if (next.length === list.length) return fail(res, 'Player not found on allowlist.', 404);
  writeJsonArray(allowlistPath(), next);
  return ok(res, { allowlist: next });
});

/** GET /api/players/permissions */
router.get('/permissions', (req, res) => {
  return ok(res, { permissions: readJsonArray(permissionsPath()) });
});

/**
 * PUT /api/players/permissions — { xuid, permission }
 * Upserts a single player's permission level (operator|member|visitor).
 */
router.put('/permissions', (req, res) => {
  const { xuid, permission } = req.body || {};
  const valid = ['operator', 'member', 'visitor'];
  if (!xuid || !valid.includes(permission)) {
    return fail(res, 'A valid xuid and permission (operator|member|visitor) are required.', 400);
  }
  const list = readJsonArray(permissionsPath());
  const existing = list.find((p) => p.xuid === String(xuid));
  if (existing) existing.permission = permission;
  else list.push({ permission, xuid: String(xuid) });
  writeJsonArray(permissionsPath(), list);
  return ok(res, { permissions: list });
});

/**
 * DELETE /api/players/permissions/:xuid
 * Removes a player's permission override (they fall back to the default).
 */
router.delete('/permissions/:xuid', (req, res) => {
  const xuid = String(req.params.xuid);
  if (!/^\d{1,20}$/.test(xuid)) return fail(res, 'Invalid xuid.', 400);
  const list = readJsonArray(permissionsPath());
  const next = list.filter((p) => p.xuid !== xuid);
  if (next.length === list.length) return fail(res, 'No permission override for that player.', 404);
  writeJsonArray(permissionsPath(), next);
  return ok(res, { permissions: next });
});

/* ---------------- Ban list ----------------
 * Bedrock stores bans as an array of { name, xuid, reason? } in
 * banned-players.json (sibling of allowlist.json). We keep the shape minimal
 * — Bedrock itself only uses name + xuid; reason is for the admin's own
 * records.
 */

/** GET /api/players/bans */
router.get('/bans', (req, res) => {
  return ok(res, { bans: readJsonArray(bansPath()) });
});

/** POST /api/players/bans — { name, xuid, reason? } */
router.post('/bans', (req, res) => {
  const { name, xuid, reason } = req.body || {};
  if (!name || !xuid) return fail(res, 'Both name and xuid are required.', 400);
  if (!/^\d{1,20}$/.test(String(xuid))) return fail(res, 'Invalid xuid.', 400);
  const list = readJsonArray(bansPath());
  if (list.some((p) => p.xuid === String(xuid))) {
    return fail(res, `${name} is already banned.`, 409);
  }
  const entry = { name, xuid: String(xuid) };
  if (reason) entry.reason = String(reason).slice(0, 200);
  list.push(entry);
  writeJsonArray(bansPath(), list);
  return ok(res, { bans: list }, 201);
});

/** DELETE /api/players/bans/:xuid */
router.delete('/bans/:xuid', (req, res) => {
  const xuid = String(req.params.xuid);
  if (!/^\d{1,20}$/.test(xuid)) return fail(res, 'Invalid xuid.', 400);
  const list = readJsonArray(bansPath());
  const next = list.filter((p) => p.xuid !== xuid);
  if (next.length === list.length) return fail(res, 'Player not in ban list.', 404);
  writeJsonArray(bansPath(), next);
  return ok(res, { bans: next });
});

module.exports = router;
