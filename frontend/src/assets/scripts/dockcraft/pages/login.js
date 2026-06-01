/**
 * login.js — JWT login page.
 *
 * UI: split-screen brand panel + form panel (see login.html). Behaviour:
 *  - pre-fills username from localStorage when "Remember me" was checked
 *  - show/hide password toggle, with proper aria-pressed state
 *  - inline error region (role="alert") rather than toasts so it can't be missed
 *  - special handling for 429 (rate-limited): wait message is shown
 *  - forgot-password link opens an inline panel with recovery instructions
 *  - "Remember me" persists username; token persistence is in api.js as before
 */

import { apiFetch, setToken, withButtonSpinner } from '../api';

const USERNAME_KEY = 'dockcraft-remembered-user';

function showError(msg) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}
function clearError() {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}
function setStatus(msg) {
  const el = document.getElementById('loginStatus');
  if (el) el.textContent = msg;
}

export async function init() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  const usernameInput = form.username;
  const passwordInput = form.password;
  const rememberBox = document.getElementById('rememberMe');
  const pwToggle = document.getElementById('pwToggle');
  const submit = form.querySelector('button[type="submit"]');

  // Pre-fill username if previously remembered.
  try {
    const remembered = localStorage.getItem(USERNAME_KEY);
    if (remembered) {
      usernameInput.value = remembered;
      rememberBox.checked = true;
      passwordInput.focus();
    } else {
      usernameInput.focus();
    }
  } catch { usernameInput.focus(); }

  // Show/hide password.
  pwToggle?.addEventListener('click', () => {
    const hidden = passwordInput.type === 'password';
    passwordInput.type = hidden ? 'text' : 'password';
    pwToggle.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    pwToggle.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
  });

  // Clear inline error as soon as the user starts editing.
  form.addEventListener('input', clearError);

  // Forgot-password panel.
  const forgotLink = document.getElementById('forgotLink');
  const forgotPanel = document.getElementById('forgotPanel');
  const forgotClose = document.getElementById('forgotClose');
  forgotLink?.addEventListener('click', (e) => {
    e.preventDefault();
    forgotPanel.hidden = !forgotPanel.hidden;
    if (!forgotPanel.hidden) forgotClose?.focus();
  });
  forgotClose?.addEventListener('click', () => {
    forgotPanel.hidden = true;
    forgotLink.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      showError('Please enter both a username and a password.');
      return;
    }
    clearError();
    setStatus('');
    const restore = withButtonSpinner(submit, 'Signing in…');
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      setToken(data.token, data.username);
      try {
        if (rememberBox.checked) localStorage.setItem(USERNAME_KEY, username);
        else localStorage.removeItem(USERNAME_KEY);
      } catch { /* storage unavailable */ }
      setStatus('Signed in. Redirecting…');
      setTimeout(() => { location.href = 'index.html'; }, 250);
    } catch (err) {
      // Show lockout hint on 429; everything else falls through to message.
      const message = err.status === 429
        ? 'Too many sign-in attempts. Please wait a minute and try again.'
        : err.message;
      showError(message);
      restore();
      passwordInput.focus();
      passwordInput.select();
    }
  });
}
