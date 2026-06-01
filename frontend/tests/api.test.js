/**
 * tests/api.test.js — apiFetch, token helpers, guard.
 *
 * jsdom provides fetch; we stub it for the tests below.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, getToken, setToken, clearToken, getUser, guard, toast } from '../src/assets/scripts/dockcraft/api.js';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('token helpers', () => {
  it('round-trips a token and username', () => {
    setToken('abc.def.ghi', 'admin');
    expect(getToken()).toBe('abc.def.ghi');
    expect(getUser()).toBe('admin');
  });
  it('clears both token and user', () => {
    setToken('xyz', 'admin');
    clearToken();
    expect(getToken()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

describe('apiFetch', () => {
  it('attaches Authorization when a token is present', async () => {
    setToken('tkn-1', 'admin');
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: { ok: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const data = await apiFetch('/ping');
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/ping', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tkn-1' }),
    }));
  });

  it('serializes JSON body and sets content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, data: null }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/echo', { method: 'POST', body: { hello: 'world' } });
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/echo');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Content-Type']).toBe('application/json');
    expect(call[1].body).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('throws a friendly error on a non-2xx envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 400,
      json: async () => ({ success: false, error: 'Bad input.' }),
    }));
    await expect(apiFetch('/bad')).rejects.toThrow('Bad input.');
  });

  it('redirects to login on 401 and clears the token', async () => {
    setToken('expired');
    // jsdom keeps `location` mutable; record the assignment.
    delete window.location;
    window.location = { href: '', pathname: '/index.html' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    }));
    await expect(apiFetch('/secret')).rejects.toThrow(/Session expired/);
    expect(getToken()).toBeNull();
    expect(window.location.href).toBe('login.html');
  });
});

describe('guard', () => {
  it('redirects to setup when not set up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ data: { setupComplete: false, hasAdmin: false } }),
    }));
    delete window.location;
    window.location = { href: '', pathname: '/index.html' };
    const ok = await guard();
    expect(ok).toBe(false);
    expect(window.location.href).toBe('setup.html');
  });

  it('redirects to login when set up but not signed in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ data: { setupComplete: true, hasAdmin: true } }),
    }));
    delete window.location;
    window.location = { href: '', pathname: '/index.html' };
    const ok = await guard();
    expect(ok).toBe(false);
    expect(window.location.href).toBe('login.html');
  });

  it('returns true on the login page when set up', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ data: { setupComplete: true, hasAdmin: true } }),
    }));
    delete window.location;
    window.location = { href: '', pathname: '/login.html' };
    const ok = await guard({ page: 'login' });
    expect(ok).toBe(true);
  });
});

describe('toast', () => {
  it('creates a toast in a status live region', () => {
    toast('Hello', 'info');
    const host = document.querySelector('.dc-toast-host');
    expect(host).toBeTruthy();
    expect(host.getAttribute('aria-live')).toBe('polite');
    const t = host.querySelector('.dc-toast');
    expect(t).toBeTruthy();
    expect(t.textContent).toBe('Hello');
  });
});
