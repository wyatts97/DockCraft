/**
 * mods.js (route) — installed pack management.
 *
 * Lists installed behavior/resource packs, accepts uploads (.mcaddon/.mcpack),
 * installs from a URL, toggles enable/disable (world JSON), and deletes packs.
 * Changes take effect after a server restart, which the UI prompts for.
 */

const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const packManager = require('../services/packManager');
const { ok, fail } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 512 * 1024 * 1024 } });

/** GET /api/mods */
router.get('/', (req, res) => {
  try {
    return ok(res, { mods: packManager.listInstalled() });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

/** POST /api/mods/upload — multipart "pack" (.mcaddon/.mcpack/.zip) */
router.post('/upload', upload.single('pack'), (req, res) => {
  if (!req.file) return fail(res, 'No pack file uploaded.', 400);
  try {
    const installed = packManager.installFromFile(req.file.path, { activate: true });
    fs.rmSync(req.file.path, { force: true });
    return ok(res, { installed }, 201);
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return fail(res, err.message, 400);
  }
});

/** POST /api/mods/install-url — { url } */
router.post('/install-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return fail(res, 'A download URL is required.', 400);

  let tmpFile;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) return fail(res, `Download failed (status ${response.status}).`, 502);
    const buffer = Buffer.from(await response.arrayBuffer());
    tmpFile = path.join(os.tmpdir(), `dockcraft-dl-${Date.now()}.zip`);
    fs.writeFileSync(tmpFile, buffer);
    const installed = packManager.installFromFile(tmpFile, { activate: true });
    return ok(res, { installed }, 201);
  } catch (err) {
    const code = err.name === 'TimeoutError' ? 504 : 502;
    return fail(res, `Could not install from URL: ${err.message}`, code);
  } finally {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
  }
});

/** PUT /api/mods/:uuid/toggle */
router.put('/:uuid/toggle', (req, res) => {
  try {
    const enabled = packManager.toggle(req.params.uuid);
    return ok(res, { uuid: req.params.uuid, enabled });
  } catch (err) {
    return fail(res, err.message, 404);
  }
});

/** DELETE /api/mods/:uuid */
router.delete('/:uuid', (req, res) => {
  try {
    packManager.remove(req.params.uuid);
    return ok(res, { deleted: req.params.uuid });
  } catch (err) {
    return fail(res, err.message, 404);
  }
});

module.exports = router;
