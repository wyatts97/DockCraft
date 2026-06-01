/**
 * backupManager.js — zip/unzip world directories under /data/worlds.
 *
 * Backups are stored as timestamped .zip files in /data/backups. Restoring
 * extracts a backup over the world directory; the caller (worlds route) is
 * responsible for stopping the server first and restarting after.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const config = require('../config');

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

function backupPath(filename) {
  const safe = path.basename(filename); // prevent path traversal
  return path.join(backupsDir(), safe);
}

/** Restore a backup into the active world directory (server must be stopped). */
function restoreBackup(filename, worldName) {
  const p = backupPath(filename);
  if (!fs.existsSync(p)) throw new Error('Backup not found.');
  const level = worldName || config.load().env.LEVEL_NAME || 'Bedrock level';
  const dest = path.join(worldsDir(), level);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  new AdmZip(p).extractAllTo(dest, true);
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
  const dest = path.join(worldsDir(), level);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  new AdmZip(archivePath).extractAllTo(dest, true);
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
