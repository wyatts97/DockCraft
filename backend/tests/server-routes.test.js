/**
 * tests/server-routes.test.js — /api/server route.
 *
 * Covers the stats history endpoint and the high-level status endpoint.
 * Docker is mocked; we don't need a real daemon.
 */

const http = require('node:http');
const express = require('express');

const { writeConfig, clearSandbox, mockDocker } = require('./helpers');

let router;
beforeEach(() => {
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, '/').match(/(routes[\/]server|services[\/]realtime|realtime|docker)/)) {
      delete require.cache[key];
    }
  }
  clearSandbox();
  writeConfig();
  mockDocker({ containerState: 'running' });
  router = require('../routes/server');
});

function boot() {
  const app = express();
  app.use(express.json());
  app.use('/api/server', router);
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      resolve({ srv, port: srv.address().port });
    });
  });
}

function req(method, port, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    r.end();
  });
}

describe('GET /api/server/stats/history', () => {
  it('returns an empty array when no samples have been recorded', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/server/stats/history');
      expect(r.status).toBe(200);
      expect(r.body.data.points).toEqual([]);
    } finally { srv.close(); }
  });

  it('returns recorded samples in chronological order', async () => {
    const realtime = require('../realtime');
    realtime._recordStats({ cpu: 10, memory: 20, uptimeSeconds: 0, running: true, playerCount: 0 });
    realtime._recordStats({ cpu: 15, memory: 25, uptimeSeconds: 5, running: true, playerCount: 1 });
    realtime._recordStats({ cpu: 8, memory: 22, uptimeSeconds: 10, running: true, playerCount: 1 });
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/server/stats/history');
      expect(r.status).toBe(200);
      expect(r.body.data.points).toHaveLength(3);
      expect(r.body.data.points.map((p) => p.cpu)).toEqual([10, 15, 8]);
      expect(r.body.data.points.map((p) => p.playerCount)).toEqual([0, 1, 1]);
    } finally { srv.close(); }
  });

  it('caps the ring buffer at STATS_HISTORY_SIZE samples', async () => {
    const realtime = require('../realtime');
    for (let i = 0; i < 65; i++) {
      realtime._recordStats({ cpu: i, memory: i, uptimeSeconds: i, running: true, playerCount: 0 });
    }
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/server/stats/history');
      expect(r.status).toBe(200);
      expect(r.body.data.points).toHaveLength(60);
      expect(r.body.data.points[0].cpu).toBe(5);
      expect(r.body.data.points[59].cpu).toBe(64);
    } finally { srv.close(); }
  });
});
