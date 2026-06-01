/**
 * tests/players.test.js — /api/players routes.
 *
 * Mounts the players router on a fresh express app + a real http server so
 * we exercise the full request/response cycle (including express middleware).
 * The config layer is pointed at the sandbox via tests/setup.js.
 */

const http = require('node:http');
const express = require('express');

const { writeConfig, clearSandbox, DATA_PATH, mockDocker } = require('./helpers');

let router;
beforeEach(async () => {
  // Clear module cache so the players route re-reads config from disk.
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, '/').match(/(routes[\/]players|services[\/]logParser|services[\/]xuidLookup)/)) {
      delete require.cache[key];
    }
  }
  clearSandbox();
  writeConfig();
  // Mock xuid lookup so add-by-gamertag is deterministic.
  const xuid = require('../services/xuidLookup');
  xuid.lookup = async (gamertag) => ({ name: gamertag, xuid: '1234567890' });
  // Mock logParser to return an empty player list.
  const logParser = require('../services/logParser');
  logParser.snapshot = () => [];
  logParser.parse = () => {};
  // Mock docker so /online doesn't try to reach a daemon.
  mockDocker({ containerState: 'running' });
  router = require('../routes/players');
});

function boot() {
  const app = express();
  app.use(express.json());
  app.use('/api/players', router);
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      const port = srv.address().port;
      resolve({ srv, port, app });
    });
  });
}

function req(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path, method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

describe('GET /api/players/online', () => {
  it('returns empty list when no players are connected', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/players/online');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, data: { players: [] } });
    } finally { srv.close(); }
  });
});

describe('Allowlist', () => {
  it('GET returns empty initially', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/players/allowlist');
      expect(r.status).toBe(200);
      expect(r.body.data.allowlist).toEqual([]);
    } finally { srv.close(); }
  });

  it('POST adds a player and writes to disk', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/players/allowlist', { name: 'Steve', xuid: '12345' });
      expect(r.status).toBe(201);
      const list = await req('GET', port, '/api/players/allowlist');
      expect(list.body.data.allowlist).toEqual([
        { ignoresPlayerLimit: false, name: 'Steve', xuid: '12345' },
      ]);
    } finally { srv.close(); }
  });

  it('POST returns 409 on duplicate xuid', async () => {
    const { srv, port } = await boot();
    try {
      await req('POST', port, '/api/players/allowlist', { name: 'Steve', xuid: '12345' });
      const r = await req('POST', port, '/api/players/allowlist', { name: 'Steve2', xuid: '12345' });
      expect(r.status).toBe(409);
    } finally { srv.close(); }
  });

  it('POST rejects missing name or xuid', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/players/allowlist', { name: 'X' });
      expect(r.status).toBe(400);
    } finally { srv.close(); }
  });

  it('DELETE removes a player by xuid', async () => {
    const { srv, port } = await boot();
    try {
      await req('POST', port, '/api/players/allowlist', { name: 'Steve', xuid: '12345' });
      const r = await req('DELETE', port, '/api/players/allowlist/12345');
      expect(r.status).toBe(200);
      const list = await req('GET', port, '/api/players/allowlist');
      expect(list.body.data.allowlist).toEqual([]);
    } finally { srv.close(); }
  });

  it('DELETE on missing xuid returns 404', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('DELETE', port, '/api/players/allowlist/99999');
      expect(r.status).toBe(404);
    } finally { srv.close(); }
  });
});

describe('Permissions', () => {
  it('GET returns empty initially', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/players/permissions');
      expect(r.status).toBe(200);
      expect(r.body.data.permissions).toEqual([]);
    } finally { srv.close(); }
  });

  it('PUT upserts a single player permission', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('PUT', port, '/api/players/permissions', { xuid: '12345', permission: 'operator' });
      expect(r.status).toBe(200);
      const list = await req('GET', port, '/api/players/permissions');
      expect(list.body.data.permissions).toEqual([{ xuid: '12345', permission: 'operator' }]);
    } finally { srv.close(); }
  });

  it('PUT rejects unknown permission values', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('PUT', port, '/api/players/permissions', { xuid: '12345', permission: 'super-admin' });
      expect(r.status).toBe(400);
    } finally { srv.close(); }
  });

  it('DELETE removes a single player', async () => {
    const { srv, port } = await boot();
    try {
      await req('PUT', port, '/api/players/permissions', { xuid: '12345', permission: 'operator' });
      await req('PUT', port, '/api/players/permissions', { xuid: '67890', permission: 'member' });
      const r = await req('DELETE', port, '/api/players/permissions/12345');
      expect(r.status).toBe(200);
      const list = await req('GET', port, '/api/players/permissions');
      expect(list.body.data.permissions).toEqual([{ xuid: '67890', permission: 'member' }]);
    } finally { srv.close(); }
  });

  it('DELETE on missing xuid returns 404', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('DELETE', port, '/api/players/permissions/99999');
      expect(r.status).toBe(404);
    } finally { srv.close(); }
  });

  it('DELETE on non-numeric xuid returns 400', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('DELETE', port, '/api/players/permissions/not-numeric');
      expect(r.status).toBe(400);
    } finally { srv.close(); }
  });
});

describe('Bans', () => {
  it('GET returns empty initially', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/players/bans');
      expect(r.status).toBe(200);
      expect(r.body.data.bans).toEqual([]);
    } finally { srv.close(); }
  });

  it('POST adds a ban', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/players/bans', { name: 'Griefer', xuid: '12345' });
      expect(r.status).toBe(201);
      const list = await req('GET', port, '/api/players/bans');
      expect(list.body.data.bans).toEqual([{ name: 'Griefer', xuid: '12345' }]);
    } finally { srv.close(); }
  });

  it('POST duplicate returns 409', async () => {
    const { srv, port } = await boot();
    try {
      await req('POST', port, '/api/players/bans', { name: 'Griefer', xuid: '12345' });
      const r = await req('POST', port, '/api/players/bans', { name: 'Griefer', xuid: '12345' });
      expect(r.status).toBe(409);
    } finally { srv.close(); }
  });

  it('POST rejects non-numeric xuid', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/players/bans', { name: 'X', xuid: 'not-numeric' });
      expect(r.status).toBe(400);
    } finally { srv.close(); }
  });

  it('DELETE removes a ban', async () => {
    const { srv, port } = await boot();
    try {
      await req('POST', port, '/api/players/bans', { name: 'Griefer', xuid: '12345' });
      const r = await req('DELETE', port, '/api/players/bans/12345');
      expect(r.status).toBe(200);
      const list = await req('GET', port, '/api/players/bans');
      expect(list.body.data.bans).toEqual([]);
    } finally { srv.close(); }
  });

  it('DELETE on missing xuid returns 404', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('DELETE', port, '/api/players/bans/99999');
      expect(r.status).toBe(404);
    } finally { srv.close(); }
  });
});
