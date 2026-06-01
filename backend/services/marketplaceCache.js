/**
 * marketplaceCache.js — serve marketplace packs from a cached snapshot.
 *
 * Scraping cfwidget on every page load would be slow and rude, so we cache the
 * normalised packs to a JSON file and only re-scrape on explicit refresh.
 *
 * Read order:
 *   1. the writable cache at DATA_PATH/marketplace-cache.json (latest refresh)
 *   2. the committed seed at marketplace/packs.json (offline fallback)
 *
 * The cache lives under the shared data volume so it persists across restarts
 * and container rebuilds. If the data path isn't writable (e.g. local dev on a
 * machine without /data), we fall back to an in-memory copy.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const curseforge = require('./curseforgeClient');

const SEED_PATH = path.join(__dirname, '..', '..', 'marketplace', 'packs.json');
const SOURCES_PATH = path.join(__dirname, '..', '..', 'marketplace', 'sources.json');

let memoryCache = null;

function cachePath() {
  return path.join(config.load().dataPath, 'marketplace-cache.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The list of CurseForge project paths to scrape. */
function loadSources() {
  const data = readJson(SOURCES_PATH);
  return data && Array.isArray(data.sources) ? data.sources : [];
}

/** Current registry: cache file, else in-memory, else the committed seed. */
function read() {
  const fromFile = readJson(cachePath());
  if (fromFile && Array.isArray(fromFile.packs)) return fromFile;
  if (memoryCache) return memoryCache;
  const seed = readJson(SEED_PATH);
  if (seed && Array.isArray(seed.packs)) return seed;
  return { updated: null, packs: [], errors: [] };
}

/** Persist a registry to the cache file (and always keep an in-memory copy). */
function write(registry) {
  memoryCache = registry;
  try {
    const file = cachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(registry, null, 2), 'utf8');
  } catch (err) {
    console.error('[marketplace] Could not write cache file, keeping in-memory only:', err.message);
  }
  return registry;
}

/** Re-scrape every source via cfwidget and update the cache. */
async function refresh() {
  const sources = loadSources();
  const { packs, errors } = await curseforge.fetchAll(sources);
  const registry = {
    updated: new Date().toISOString(),
    source: 'curseforge',
    packs,
    errors,
  };
  return write(registry);
}

/** Look up a single cached pack by its slug id. */
function findById(id) {
  return read().packs.find((p) => p.id === id) || null;
}

module.exports = { read, write, refresh, findById, loadSources, SEED_PATH };
