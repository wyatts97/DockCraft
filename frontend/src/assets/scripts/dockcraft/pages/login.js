/**
 * login.js — JWT login page.
 */

import { apiFetch, setToken, toast, withButtonSpinner } from '../api';

export async function init() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    const btn = form.querySelector('[type="submit"]');
    const restore = withButtonSpinner(btn, 'Signing in…');
    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      setToken(data.token, data.username);
      location.href = 'index.html';
    } catch (err) {
      toast(err.message, 'error');
      restore();
    }
  });
}
