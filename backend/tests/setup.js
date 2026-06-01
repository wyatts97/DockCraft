/**
 * tests/setup.js — runs before every test file.
 *
 * Routes every config + data I/O through a unique sandbox directory under
 * backend/tmp/ so tests can mutate the runtime config without affecting the
 * real dockcraft.config.json or the host's data directory.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const SANDBOX_ROOT = path.join(__dirname, '..', 'tmp');

// Per-process sandbox keyed by a random token, so concurrent Vitest workers
// (and parallel files within a worker) never share config or data files.
const sandboxToken = crypto.randomBytes(6).toString('hex');
const sandbox = path.join(SANDBOX_ROOT, sandboxToken);

fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });

process.env.CONFIG_PATH = path.join(sandbox, 'dockcraft.config.json');
process.env.DATA_PATH = path.join(sandbox, 'data');
process.env.JWT_SECRET = 'test-secret-32-chars-min-yes-padding-' + sandboxToken;
process.env.NODE_ENV = 'test';
