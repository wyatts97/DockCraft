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
 *
 * Security: the archive is read with `getEntries()` and every entry name is
 * validated before being written to disk. Path-traversal segments (`..`,
 * absolute paths) and entries whose normalized path escapes the destination
 * directory are rejected. The total entry count is capped to defuse zip
 * bombs. Pack uuids are validated against the canonical 8-4-4-4-12 pattern.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const config = require('../config');

const MAX_ARCHIVE_ENTRIES = 5000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;       // 512 MB per file
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INNER_ARCHIVE_EXTS = new Set(['.zip', '.mcpack', '.mcbehavior', '.mcaddon']);

/**
 * Thrown when an archive is extracted successfully but no manifest.json can
 * be found at any depth (including inside inner .mcpack / .mcaddon archives).
 * The frontend can match on `err.kind === 'manifest_missing'` to show a
 * "this pack can't be auto-installed" hint instead of the generic toast.
 */
class ManifestMissingError extends Error {
  constructor(scannedDir, triedPaths = []) {
    super('No manifest.json found in the uploaded pack.');
    this.name = 'ManifestMissingError';
    this.kind = 'manifest_missing';
    this.scannedDir = scannedDir;
    this.triedPaths = triedPaths;
  }
}

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
  const uuid = typeof header.uuid === 'string' ? header.uuid : '';
  return {
    uuid,
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

/**
 * CurseForge / MCPEDL pack downloads are sometimes an *outer* archive that
 * wraps one or more *inner* .mcpack / .mcbehavior / .mcaddon archives — the
 * actual manifest lives inside the inner archive. findManifests only walks
 * directories, so without this step the manifest is never seen.
 *
 * This walks `rootDir` recursively, extracts every file whose extension
 * matches INNER_ARCHIVE_EXTS into a sibling `_inner/` folder, and deletes
 * the original. Uses safeExtract so all the zip-slip / size / entry caps
 * apply to inner archives too.
 */
function unwrapInnerArchives(rootDir) {
  const innerOut = path.join(rootDir, '_inner');
  let extracted = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (full === innerOut) continue;
        walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!INNER_ARCHIVE_EXTS.has(ext)) continue;
      try {
        const stem = path.basename(e.name, ext);
        const dest = path.join(innerOut, `${stem}-${extracted}`);
        fs.mkdirSync(dest, { recursive: true });
        safeExtract(full, dest);
        fs.rmSync(full, { force: true });
        extracted += 1;
        // Recurse into what we just extracted — packs can be zips-of-zips.
        walk(dest);
      } catch {
        // If an inner archive is corrupt, leave it; the outer install
        // attempt will report the manifest failure with full context.
      }
    }
  };
  walk(rootDir);
  return extracted;
}

/**
 * Flatten the directory tree into a list of relative file paths. Used to
 * build diagnostic context for ManifestMissingError so the user/operator
 * can see what was actually inside the archive.
 */
function listAllFiles(rootDir) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk(rootDir, '');
  return out;
}

/**
 * If the only thing inside `rootDir` is a single subdirectory, promote its
 * contents to the top level. This handles the common .mcaddon shape where
 * the outer zip contains one folder that contains the manifest.
 */
function peelSinglePackWrapper(rootDir) {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const inner = path.join(rootDir, entries[0].name);
  // Don't peel _inner/ — that's our own unwrap target.
  if (entries[0].name === '_inner') return;
  for (const e of fs.readdirSync(inner, { withFileTypes: true })) {
    const from = path.join(inner, e.name);
    const to = path.join(rootDir, e.name);
    try { fs.renameSync(from, to); } catch { /* ignore collisions */ }
  }
  try { fs.rmdirSync(inner); } catch { /* best effort */ }
}

/** Return true if a path attempts traversal or absolute. */
function isUnsafePath(p) {
  if (typeof p !== 'string' || !p) return true;
  if (path.isAbsolute(p)) return true;
  // Normalize and look for parent-dir segments anywhere in the path.
  const parts = p.split(/[\\/]+/);
  return parts.some((part) => part === '..');
}

/**
 * Extract an archive safely into `dest`. Returns the number of entries
 * extracted. Throws on path traversal, too many entries, oversized files, or
 * archive read errors. Always cleans up the temp dir on failure.
 */
function safeExtract(archivePath, dest) {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Archive has too many entries (max ${MAX_ARCHIVE_ENTRIES}).`);
  }
  fs.mkdirSync(dest, { recursive: true });

  let count = 0;
  for (const entry of entries) {
    // AdmZip already rejects most zip-slip vectors, but defend in depth.
    const name = entry.entryName;
    if (isUnsafePath(name)) {
      throw new Error(`Archive contains an unsafe path: ${name}`);
    }
    const target = path.resolve(dest, name);
    if (!target.startsWith(path.resolve(dest) + path.sep) && target !== path.resolve(dest)) {
      throw new Error(`Archive entry escapes destination: ${name}`);
    }
    if (entry.header.size > MAX_FILE_BYTES) {
      throw new Error(`Archive entry is too large: ${name}`);
    }
    // extractEntryTo with overwrite=false would throw on conflicts; AdmZip's
    // zip.extractAllTo uses the second arg as overwrite — we do entry-by-
    // entry so we can pre-validate.
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
    count += 1;
  }
  return count;
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
    safeExtract(archivePath, tmp);
    // Many packs ship as outer .mcaddon wrapping inner .mcpack archives.
    // Unwrap any nested archives, then peel a single-folder wrapper so the
    // manifest lands at the top of the tree.
    unwrapInnerArchives(tmp);
    peelSinglePackWrapper(tmp);
    const manifestDirs = findManifests(tmp);
    if (manifestDirs.length === 0) {
      throw new ManifestMissingError(tmp, listAllFiles(tmp).slice(0, 20));
    }

    const installed = [];
    for (const dir of manifestDirs) {
      const manifest = parseManifest(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const meta = packMetaFromManifest(manifest, dir);
      // Reject malformed or duplicate-looking uuids early.
      if (!UUID_RE.test(meta.uuid)) {
        // Skip but don't fail the whole install — some packs ship without one.
        continue;
      }

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
    if (installed.length === 0) {
      throw new Error('No valid (uuid-bearing) pack was found in the archive.');
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
        if (!UUID_RE.test(meta.uuid)) continue;
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
  if (!UUID_RE.test(uuid)) return null;
  return listInstalled().find((p) => p.uuid === uuid) || null;
}

/** Enable/disable a pack by editing the world JSON. Returns new enabled state. */
function toggle(uuid) {
  if (!UUID_RE.test(uuid)) throw new Error('Invalid pack id.');
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
  if (!UUID_RE.test(uuid)) throw new Error('Invalid pack id.');
  const pack = findByUuid(uuid);
  if (!pack) throw new Error('Pack not found.');
  unregisterFromWorld(uuid, pack.type);
  const root = pack.type === 'resource' ? resourceDir() : behaviorDir();
  // Confirm the resolved path is still inside the pack root — defense in
  // depth against a hostile config pointing dataPath somewhere unexpected.
  const resolved = path.resolve(path.join(root, pack.folder));
  const expectedRoot = path.resolve(root) + path.sep;
  if (!resolved.startsWith(expectedRoot)) {
    throw new Error('Pack path is outside the data directory.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
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
  // Exported for unit testing.
  isUnsafePath,
  safeExtract,
  ManifestMissingError,
  unwrapInnerArchives,
  peelSinglePackWrapper,
};
