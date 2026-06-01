/**
 * worlds.js (route) — list worlds, backup/restore, upload, download backups.
 *
 * Restore and upload are destructive to the active world, so the route stops
 * the server first, performs the operation, then restarts it.
 */

const express = require('express');
const os = require('os');
const fs = require('fs');
const multer = require('multer');
const docker = require('../docker');
const backupManager = require('../services/backupManager');
const logParser = require('../services/logParser');
const { ok, fail } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024 } });

/** GET /api/worlds */
router.get('/', (req, res) => {
  try {
    return ok(res, { worlds: backupManager.listWorlds() });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

/** GET /api/worlds/backups */
router.get('/backups', (req, res) => {
  try {
    return ok(res, { backups: backupManager.listBackups() });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

/** POST /api/worlds/backup — zips the active world */
router.post('/backup', (req, res) => {
  try {
    const backup = backupManager.createBackup(req.body?.world);
    return ok(res, { backup }, 201);
  } catch (err) {
    return fail(res, err.message, 400);
  }
});

/** GET /api/worlds/backups/:filename/download */
router.get('/backups/:filename/download', (req, res) => {
  try {
    const p = backupManager.backupPath(req.params.filename);
    if (!fs.existsSync(p)) return fail(res, 'Backup not found.', 404);
    return res.download(p);
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

/** DELETE /api/worlds/backups/:filename */
router.delete('/backups/:filename', (req, res) => {
  try {
    backupManager.deleteBackup(req.params.filename);
    return ok(res, { deleted: req.params.filename });
  } catch (err) {
    return fail(res, err.message, 404);
  }
});

/** Stop the server (if running), run fn, then restart. Returns restarted flag. */
async function withServerStopped(fn) {
  let wasRunning = false;
  try {
    const s = await docker.status();
    wasRunning = s.running;
  } catch {
    /* container may not exist yet */
  }
  if (wasRunning) {
    await docker.stop();
    logParser.reset();
  }
  await fn();
  if (wasRunning) await docker.start();
  return wasRunning;
}

/** POST /api/worlds/restore — { filename } */
router.post('/restore', async (req, res) => {
  const { filename } = req.body || {};
  if (!filename) return fail(res, 'A backup filename is required.', 400);
  try {
    let result;
    const restarted = await withServerStopped(async () => {
      result = backupManager.restoreBackup(filename);
    });
    return ok(res, { ...result, restarted });
  } catch (err) {
    return fail(res, err.message, err.code || 500);
  }
});

/** POST /api/worlds/upload — multipart "world" zip */
router.post('/upload', upload.single('world'), async (req, res) => {
  if (!req.file) return fail(res, 'No world file uploaded.', 400);
  try {
    let result;
    const restarted = await withServerStopped(async () => {
      result = backupManager.importWorld(req.file.path, req.body?.world);
    });
    fs.rmSync(req.file.path, { force: true });
    return ok(res, { ...result, restarted });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return fail(res, err.message, err.code || 500);
  }
});

module.exports = router;
