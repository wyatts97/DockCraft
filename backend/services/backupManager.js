/**
 * backupManager.js — zip/unzip world directories under /data/worlds.
 *
 * Backups are stored as timestamped .zip files in /data/backups. Restoring
 * extracts a backup over the world directory; the caller (worlds route) is
 * responsible for stopping the server first and restarting after.
 *
 * Security: every extracted entry is validated against the destination
 * directory (path-traversal guard) via the shared packManager.safeExtract
 * helper. Filename lookups confirm the resolved path still lives inside
 * backupsDir before any read/delete/restore.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { safeExtract } = require('./packManager');

function dataPath() {
  return config.load().dataPath;
}
function worldsDir() {
  return path.join(dataPath(), 'worlds');
}
function backupsDir() {
  return path.join(dataPath(), 'backups');
}

function ensureDirs() {
  fs.mkdirSync(worldsDir(), { recursive: true });
  fs.mkdirSync(backupsDir(), { recursive: true });
}

/** List world directories under /data/worlds. */
function listWorlds() {
  ensureDirs();
  return fs
    .readdirSync(worldsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(worldsDir(), e.name);
      let seed = null;
      try {
        // levelname.txt / level data isn't easily parsed; expose name only.
      } catch { /* noop */ }
      return { name: e.name, seed, path: dir };
    });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Zip the active world into /data/backups. Returns backup metadata. */
function createBackup(worldName) {
  ensureDirs();
  const level = worldName || config.load().env.LEVEL_NAME || 'Bedrock level';
  const src = path.join(worldsDir(), level);
  if (!fs.existsSync(src)) {
    throw new Error(`World "${level}" does not exist yet. Start the server once to generate it.`);
  }
  const filename = `${slug(level)}_${timestamp()}.zip`;
  const dest = path.join(backupsDir(), filename);
  // Use AdmZip directly here — we control the source path (it's inside our
  // data dir) so zip-slip doesn't apply. safeExtract is only needed for
  // untrusted archives.
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addLocalFolder(src);
  zip.writeZip(dest);
  const stat = fs.statSync(dest);
  return { filename, size: stat.size, createdAt: stat.mtime.toISOString(), world: level };
}

/** List available backups, newest first. */
function listBackups() {
  ensureDirs();
  return fs
    .readdirSync(backupsDir(), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.zip'))
    .map((e) => {
      const stat = fs.statSync(path.join(backupsDir(), e.name));
      return { filename: e.name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Resolve a backup filename to an absolute path inside backupsDir(). Throws
 * if the basename escapes the directory (defense in depth — path.basename
 * already strips directory components, but a misconfigured data path could
 * still point backupsDir somewhere unexpected).
 */
function backupPath(filename) {
  if (typeof filename !== 'string' || !filename) {
    throw new Error('Invalid backup filename.');
  }
  const safe = path.basename(filename); // prevent path traversal
  if (!safe || safe !== filename.replace(/\\/g, '/').split('/').pop()) {
    throw new Error('Invalid backup filename.');
  }
  const resolved = path.resolve(path.join(backupsDir(), safe));
  const root = path.resolve(backupsDir());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Backup path is outside the data directory.');
  }
  return resolved;
}

/** Restore a backup into the active world directory (server must be stopped). */
function restoreBackup(filename, worldName) {
  const p = backupPath(filename);
  if (!fs.existsSync(p)) throw new Error('Backup not found.');
  const level = worldName || config.load().env.LEVEL_NAME || 'Bedrock level';
  const dest = path.resolve(path.join(worldsDir(), slug(level)));
  const worldsRoot = path.resolve(worldsDir()) + path.sep;
  if (!dest.startsWith(worldsRoot)) {
    throw new Error('World path is outside the data directory.');
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  // safeExtract enforces the zip-slip guard, entry count cap, and per-file
  // size cap. Throws on any traversal attempt.
  safeExtract(p, dest);
  return { world: level, restoredFrom: path.basename(filename) };
}

function deleteBackup(filename) {
  const p = backupPath(filename);
  if (!fs.existsSync(p)) throw new Error('Backup not found.');
  fs.rmSync(p, { force: true });
  return true;
}

/** Install an uploaded world zip as the active world directory. */
function importWorld(archivePath, worldName) {
  ensureDirs();
  const level = worldName || config.load().env.LEVEL_NAME || 'Bedrock level';
  const dest = path.resolve(path.join(worldsDir(), slug(level)));
  const worldsRoot = path.resolve(worldsDir()) + path.sep;
  if (!dest.startsWith(worldsRoot)) {
    throw new Error('World path is outside the data directory.');
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  safeExtract(archivePath, dest);
  return { world: level };
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'world';
}

module.exports = {
  listWorlds,
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  importWorld,
  backupPath,
  ensureDirs,
};
