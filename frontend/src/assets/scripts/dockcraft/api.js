/**
 * api.js — shared frontend helpers for DockCraft.
 *
 *  - apiFetch(): fetch wrapper that attaches the JWT, parses the
 *    { success, data } / { success, error } envelope, and redirects to login
 *    on 401.
 *  - toast(): bottom-right notifications for success/error/info.
 *  - token helpers + guard() that gates pages behind setup + auth.
 *
 * String/format helpers (escapeHtml, formatSize, formatUptime) live in
 * ./utils.js to avoid duplication. They're re-exported here for back-compat
 * with existing call sites.
 *
 * Every async UI action should show feedback (spinner + toast) per the
 * beginner-friendliness rules in AGENTS.md.
 */

import { escapeHtml } from './utils';

export { escapeHtml };

const TOKEN_KEY = 'dockcraft-token';
const USER_KEY = 'dockcraft-user';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token, username) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    if (username) localStorage.setItem(USER_KEY, username);
  } catch { /* storage unavailable */ }
}
export function getUser() {
  try { return localStorage.getItem(USER_KEY); } catch { return null; }
}
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch { /* noop */ }
}

/**
 * Perform an API call. Returns the `data` payload on success, throws an Error
 * with a human-readable message on failure.
 */
export async function apiFetch(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { ...headers } };
  const token = getToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;

  if (body instanceof FormData) {
    opts.body = body; // browser sets multipart boundary
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new Error('Could not reach the DockCraft server.');
  }

  if (res.status === 401) {
    clearToken();
    if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
    throw new Error('Session expired. Please sign in again.');
  }

  if (raw) return res;

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Unexpected server response (status ${res.status}).`);
  }

  if (!payload.success) {
    const err = new Error(payload.error || `Request failed (status ${res.status}).`);
    err.status = res.status;
    err.data = payload.data; // some errors carry structured context (e.g. install fallbacks)
    throw err;
  }
  return payload.data;
}

/* ---------------- Toasts ---------------- */
let toastHost = null;
function ensureToastHost() {
  if (toastHost) return toastHost;
  toastHost = document.createElement('div');
  toastHost.className = 'dc-toast-host';
  toastHost.setAttribute('role', 'status');
  toastHost.setAttribute('aria-live', 'polite');
  toastHost.setAttribute('aria-atomic', 'false');
  document.body.appendChild(toastHost);
  return toastHost;
}

export function toast(message, type = 'info', timeout = 4000) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = `dc-toast dc-toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  const remove = () => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 200);
  };
  if (timeout) setTimeout(remove, timeout);
  el.addEventListener('click', remove);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') remove();
  });
  el.tabIndex = 0;
}

/* ---------------- Auth guard ---------------- */
/**
 * Ensures the app is set up and the user is authenticated. Redirects to
 * setup.html or login.html as needed. Pass { page: 'login' | 'setup' } to skip
 * the relevant redirects for the auth pages themselves.
 */
export async function guard({ page } = {}) {
  let status;
  try {
    const res = await fetch('/api/auth/status');
    const json = await res.json();
    status = json.data;
  } catch {
    // Backend unreachable — let the page render; individual calls will error.
    return true;
  }

  if (!status.setupComplete) {
    if (page !== 'setup') { location.href = 'setup.html'; return false; }
    return true;
  }
  // Setup is complete: the wizard shouldn't be revisited.
  if (page === 'setup') { location.href = 'index.html'; return false; }

  if (!getToken()) {
    if (page !== 'login') { location.href = 'login.html'; return false; }
    return true;
  }
  if (page === 'login') { location.href = 'index.html'; return false; }
  return true;
}

/* ---------------- Small DOM helpers ---------------- */
export function withButtonSpinner(btn, label = 'Working…') {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.dataset.loading = 'true';
  btn.innerHTML = `<span class="dc-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`;
  return () => {
    btn.disabled = false;
    delete btn.dataset.loading;
    btn.innerHTML = original;
  };
}
