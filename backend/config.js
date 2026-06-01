/**
 * config.js — read/write the flat-file runtime config (dockcraft.config.json).
 *
 * No database. This file stores DockCraft's own preferences: the Minecraft
 * container name, data path, the admin credentials (bcrypt hash), the
 * environment-variable map applied to the Minecraft container, and whether the
 * first-run wizard has completed.
 *
 * All server.properties settings live in `env` and are applied to the
 * Minecraft container as environment variables — we never edit
 * server.properties directly (per AGENTS.md).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH =
  process.env.CONFIG_PATH || path.join(__dirname, 'dockcraft.config.json');

const DEFAULT_CONFIG = {
  setupComplete: false,
  containerName: process.env.MINECRAFT_CONTAINER_NAME || 'dockcraft-mc',
  image: 'itzg/minecraft-bedrock-server',
  dataPath: process.env.DATA_PATH || '/data',
  // JWT signing secret — generated once on first run if not provided via env.
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  // Admin account. Populated by the setup wizard (passwordHash via bcrypt).
  admin: {
    username: null,
    passwordHash: null,
  },
  // Environment variables applied to the Minecraft container. These map 1:1 to
  // the itzg/minecraft-bedrock-server env vars (GAMEMODE, DIFFICULTY, etc.).
  env: {
    EULA: 'TRUE',
    VERSION: 'LATEST',
    SERVER_NAME: 'DockCraft Server',
    GAMEMODE: 'survival',
    DIFFICULTY: 'normal',
    MAX_PLAYERS: '10',
    ONLINE_MODE: 'true',
    ALLOW_LIST: 'false',
    LEVEL_NAME: 'Bedrock level',
    LEVEL_SEED: '',
    LEVEL_TYPE: 'DEFAULT',
    SERVER_PORT: '19132',
    VIEW_DISTANCE: '32',
    TICK_DISTANCE: '4',
    PLAYER_IDLE_TIMEOUT: '30',
  },
};

let cache = null;

function deepMerge(base, override) {
  const out = { ...base };
  for (const key of Object.keys(override || {})) {
    const val = override[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = deepMerge(base[key] || {}, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

function load() {
  if (cache) return cache;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      cache = deepMerge(DEFAULT_CONFIG, parsed);
    } else {
      cache = deepMerge(DEFAULT_CONFIG, {});
      save(cache);
    }
  } catch (err) {
    console.error('[config] Failed to read config, using defaults:', err.message);
    cache = deepMerge(DEFAULT_CONFIG, {});
  }
  return cache;
}

function save(next) {
  cache = next;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] Failed to write config:', err.message);
    throw err;
  }
  return cache;
}

/** Shallow-merge a patch into the config and persist it. */
function update(patch) {
  const next = deepMerge(load(), patch);
  return save(next);
}

/** Replace the env map (used by the settings route) and persist. */
function setEnv(envPatch) {
  const current = load();
  const next = { ...current, env: { ...current.env, ...envPatch } };
  return save(next);
}

module.exports = { load, save, update, setEnv, CONFIG_PATH, DEFAULT_CONFIG };
