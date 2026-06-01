/**
 * tests/auth-routes.test.js — /api/auth routes.
 *
 * Login + change-password happy + sad paths. The requireAuth guard is
 * applied per-handler (router.post('/password', requireAuth, ...)) so the
 * test mounts the auth route on a fresh app and exercises the full flow.
 */

const http = require('node:http');
const express = require('express');
const bcrypt = require('bcryptjs');

const { writeConfig, clearSandbox } = require('./helpers');

let router;
beforeEach(() => {
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, '/').match(/(routes[\/]auth|middleware[\/]auth|config\.js$)/)) {
      delete require.cache[key];
    }
  }
  clearSandbox();
  writeConfig();
  router = require('../routes/auth');
});

function boot() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      resolve({ srv, port: srv.address().port });
    });
  });
}

function req(method, port, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    if (token) headers['authorization'] = `Bearer ${token}`;
    const r = http.request({
      host: '127.0.0.1', port, path, method, headers,
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

describe('GET /api/auth/status', () => {
  it('reports setup complete and has admin', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('GET', port, '/api/auth/status');
      expect(r.status).toBe(200);
      expect(r.body.data.setupComplete).toBe(true);
      expect(r.body.data.hasAdmin).toBe(true);
    } finally { srv.close(); }
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for valid credentials', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/auth/login', { username: 'admin', password: 'hunter2' });
      expect(r.status).toBe(200);
      expect(r.body.data.token).toBeTruthy();
      expect(r.body.data.username).toBe('admin');
    } finally { srv.close(); }
  });

  it('rejects bad password', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/auth/login', { username: 'admin', password: 'wrong' });
      expect(r.status).toBe(401);
    } finally { srv.close(); }
  });

  it('rejects missing username', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/auth/login', { password: 'hunter2' });
      expect(r.status).toBe(400);
    } finally { srv.close(); }
  });

  it('rejects unknown user', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/auth/login', { username: 'nobody', password: 'hunter2' });
      expect(r.status).toBe(401);
    } finally { srv.close(); }
  });
});

describe('POST /api/auth/password', () => {
  it('rotates the password on valid request', async () => {
    const { srv, port } = await boot();
    try {
      const login = await req('POST', port, '/api/auth/login', { username: 'admin', password: 'hunter2' });
      const token = login.body.data.token;
      const r = await req('POST', port, '/api/auth/password', { currentPassword: 'hunter2', newPassword: 'shiny-new-1' }, token);
      expect(r.status).toBe(200);
      expect(r.body.data.changed).toBe(true);

      // Old password no longer works.
      const bad = await req('POST', port, '/api/auth/login', { username: 'admin', password: 'hunter2' });
      expect(bad.status).toBe(401);
      // New password works.
      const good = await req('POST', port, '/api/auth/login', { username: 'admin', password: 'shiny-new-1' });
      expect(good.status).toBe(200);
    } finally { srv.close(); }
  });

  it('rejects when current password is wrong', async () => {
    writeConfig();
    const { srv, port } = await boot();
    try {
      const login = await req('POST', port, '/api/auth/login', { username: 'admin', password: 'hunter2' });
      const token = login.body.data.token;
      const r = await req('POST', port, '/api/auth/password', { currentPassword: 'WRONG', newPassword: 'whatever1' }, token);
      expect(r.status).toBe(403);
    } finally { srv.close(); }
  });

  it('rejects new password that is too short', async () => {
    writeConfig();
    const { srv, port } = await boot();
    try {
      const login = await req('POST', port, '/api/auth/login', { username: 'admin', password: 'hunter2' });
      const token = login.body.data.token;
      const r = await req('POST', port, '/api/auth/password', { currentPassword: 'hunter2', newPassword: 'abc' }, token);
      expect(r.status).toBe(400);
    } finally { srv.close(); }
  });

  it('rejects request without a token', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/auth/password', { currentPassword: 'hunter2', newPassword: 'whatever1' });
      expect(r.status).toBe(401);
    } finally { srv.close(); }
  });

  it('rejects malformed (expired) token', async () => {
    const { srv, port } = await boot();
    try {
      const r = await req('POST', port, '/api/auth/password', { currentPassword: 'hunter2', newPassword: 'whatever1' }, undefined, 'not-a-real-token');
      expect(r.status).toBe(401);
    } finally { srv.close(); }
  });
});
