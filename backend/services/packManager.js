/**
 * packManager.js — install, list, toggle and remove Bedrock add-on packs.
 *
 * Bedrock packs (.mcaddon / .mcpack) are renamed .zip archives. Each contains
 * one or more pack folders, each with a manifest.json describing:
 *   header.uuid, header.version (array), header.name, header.description
 *   modules[].type  -> "data"/"script" = behavior pack, "resources" = resource
 *
 * Install flow (per AGENTS.md):
 *   1. extract the archive
 *   2. read each manifest
 *   3. copy behavior packs -> /data/behavior_packs, resource -> /data/resource_packs
 *   4. register the pack in the world's world_*_packs.json
 *
 * Toggling on/off only edits the world JSON — pack files stay on disk.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const config = require('../config');

function dataPath() {
  return config.load().dataPath;
}
function behaviorDir() {
  return path.join(dataPath(), 'behavior_packs');
}
function resourceDir() {
  return path.join(dataPath(), 'resource_packs');
}
function worldDir() {
  const level = config.load().env.LEVEL_NAME || 'Bedrock level';
  return path.join(dataPath(), 'worlds', level);
}

function ensureDirs() {
  for (const d of [behaviorDir(), resourceDir(), worldDir()]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Read + parse a manifest.json, tolerating JSON comments/trailing commas. */
function parseManifest(raw) {
  const cleaned = raw
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned);
}

function manifestType(manifest) {
  const modules = manifest.modules || [];
  const types = modules.map((m) => (m.type || '').toLowerCase());
  if (types.includes('resources')) return 'resource';
  return 'behavior'; // data / script / client_data all live as behavior here
}

function packMetaFromManifest(manifest, dir) {
  const header = manifest.header || {};
  return {
    uuid: header.uuid,
    name: header.name || path.basename(dir),
    description: header.description || '',
    version: Array.isArray(header.version) ? header.version : [1, 0, 0],
    type: manifestType(manifest),
    dir,
  };
}

/** Walk an extracted directory and find every folder containing a manifest.json. */
function findManifests(rootDir) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasManifest = entries.some((e) => e.isFile() && e.name === 'manifest.json');
    if (hasManifest) {
      found.push(dir);
      return; // don't descend into a pack root
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
    }
  };
  walk(rootDir);
  return found;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Install a pack archive from a filesystem path. Returns array of installed
 * pack metadata. Optionally auto-activates each pack in the world JSON.
 */
function installFromFile(archivePath, { activate = true } = {}) {
  ensureDirs();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dockcraft-pack-'));
  try {
    new AdmZip(archivePath).extractAllTo(tmp, true);
    const manifestDirs = findManifests(tmp);
    if (manifestDirs.length === 0) {
      throw new Error('No manifest.json found in the uploaded pack.');
    }

    const installed = [];
    for (const dir of manifestDirs) {
      const manifest = parseManifest(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const meta = packMetaFromManifest(manifest, dir);
      if (!meta.uuid) continue;

      const targetRoot = meta.type === 'resource' ? resourceDir() : behaviorDir();
      const folderName = `${slug(meta.name)}_${meta.uuid.slice(0, 8)}`;
      const dest = path.join(targetRoot, folderName);
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      copyDir(dir, dest);

      meta.folder = folderName;
      meta.dir = dest;
      if (activate) registerInWorld(meta);
      installed.push(stripDir(meta));
    }
    return installed;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pack';
}

function worldJsonPath(type) {
  const file = type === 'resource' ? 'world_resource_packs.json' : 'world_behavior_packs.json';
  return path.join(worldDir(), file);
}

function readWorldJson(type) {
  const p = worldJsonPath(type);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function writeWorldJson(type, arr) {
  fs.mkdirSync(worldDir(), { recursive: true });
  fs.writeFileSync(worldJsonPath(type), JSON.stringify(arr, null, 2), 'utf8');
}

function registerInWorld(meta) {
  const arr = readWorldJson(meta.type);
  if (!arr.some((e) => e.pack_id === meta.uuid)) {
    arr.push({ pack_id: meta.uuid, version: meta.version });
    writeWorldJson(meta.type, arr);
  }
}

function unregisterFromWorld(uuid, type) {
  const arr = readWorldJson(type).filter((e) => e.pack_id !== uuid);
  writeWorldJson(type, arr);
}

function isActive(uuid, type) {
  return readWorldJson(type).some((e) => e.pack_id === uuid);
}

/** List every installed pack on disk with its enabled state. */
function listInstalled() {
  ensureDirs();
  const out = [];
  for (const [type, root] of [['behavior', behaviorDir()], ['resource', resourceDir()]]) {
    let folders;
    try {
      folders = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of folders) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
        const meta = packMetaFromManifest(manifest, dir);
        out.push({
          uuid: meta.uuid,
          name: meta.name,
          description: meta.description,
          version: meta.version,
          type,
          folder: entry.name,
          enabled: isActive(meta.uuid, type),
        });
      } catch (err) {
        console.error(`[packManager] Bad manifest in ${dir}:`, err.message);
      }
    }
  }
  return out;
}

function findByUuid(uuid) {
  return listInstalled().find((p) => p.uuid === uuid) || null;
}

/** Enable/disable a pack by editing the world JSON. Returns new enabled state. */
function toggle(uuid) {
  const pack = findByUuid(uuid);
  if (!pack) throw new Error('Pack not found.');
  if (pack.enabled) {
    unregisterFromWorld(uuid, pack.type);
    return false;
  }
  registerInWorld({ uuid, type: pack.type, version: pack.version });
  return true;
}

/** Remove a pack entirely: unregister from world + delete files from disk. */
function remove(uuid) {
  const pack = findByUuid(uuid);
  if (!pack) throw new Error('Pack not found.');
  unregisterFromWorld(uuid, pack.type);
  const root = pack.type === 'resource' ? resourceDir() : behaviorDir();
  fs.rmSync(path.join(root, pack.folder), { recursive: true, force: true });
  return true;
}

function stripDir(meta) {
  const { dir, ...rest } = meta;
  return rest;
}

module.exports = {
  installFromFile,
  listInstalled,
  findByUuid,
  toggle,
  remove,
  ensureDirs,
};
