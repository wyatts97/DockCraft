/**
 * tests/helpers.js — small test utilities.
 *
 * - writeConfig(partial): writes a fresh dockcraft.config.json into the
 *   sandbox with the given admin + setup state.
 * - tmpDir(sub): returns a path inside the data sandbox, creating it.
 * - clearSandbox(): wipes both config and data between tests.
 * - mockDocker(): patches backend/docker so route tests don't need a daemon.
 */

const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = path.join(__dirname, '..', 'tmp');
const CONFIG_PATH = process.env.CONFIG_PATH;
const DATA_PATH = process.env.DATA_PATH;

function writeConfig(partial = {}) {
  const cfg = {
    setupComplete: true,
    containerName: 'dockcraft-mc',
    admin: { username: 'admin', passwordHash: '$2a$10$KfFPlmg8XuqN3jJd6yRL1.FZAy6n.1ClWGNHM5lK7uIXXIhVOsBqu' }, // 'hunter2'
    jwtSecret: 'test-secret-32-chars-min-yes-padding',
    port: 0,
    ...partial,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function clearSandbox() {
  for (const p of [CONFIG_PATH, DATA_PATH]) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

function tmpDir(sub) {
  const p = path.join(DATA_PATH, sub || 'work');
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function mockDocker({ containerState = 'absent' } = {}) {
  // The backend's docker.js is a singleton that lazily calls new Dockerode().
  // We don't want real daemon calls in tests, so we hijack the module by
  // pointing its singleton at a stub. The simplest way: override the methods
  // exposed by docker.js directly.
  const docker = require('../docker');
  docker.getContainer = () => ({
    inspect: async () => {
      if (containerState === 'absent') {
        const err = new Error('no such container');
        err.statusCode = 404;
        throw err;
      }
      return { State: { Status: containerState === 'running' ? 'running' : 'exited', Running: containerState === 'running' } };
    },
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    stats: () => ({ on: () => {}, removeAllListeners: () => {} }),
    logs: () => ({ on: () => {}, removeAllListeners: () => {} }),
    exec: () => ({ start: async () => ({ on: () => {}, removeAllListeners: () => {}, write: () => {} }) }),
  });
  docker.listContainers = async () => (containerState === 'absent' ? [] : [{ Id: 'mock', Names: ['/dockcraft-mc'], State: containerState }]);
  docker.createContainer = async () => ({ id: 'mock' });
  docker.ping = async () => 'OK';
  return docker;
}

module.exports = { writeConfig, clearSandbox, tmpDir, mockDocker, SANDBOX, CONFIG_PATH, DATA_PATH };
