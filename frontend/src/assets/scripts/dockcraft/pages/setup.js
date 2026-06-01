/**
 * setup.js — first-run wizard.
 *
 * Three steps: server basics -> network & admin account -> review & launch.
 * On finish, POSTs /api/setup which creates the admin account, saves the env
 * config, optionally starts the container, and returns a JWT.
 */

import { apiFetch, setToken, toast, withButtonSpinner } from '../api';

export async function init() {
  const wizard = document.getElementById('setupWizard');
  if (!wizard) return;

  const steps = Array.from(wizard.querySelectorAll('[data-step]'));
  const dots = Array.from(wizard.querySelectorAll('[data-dot]'));
  let current = 0;

  const show = (idx) => {
    current = Math.max(0, Math.min(steps.length - 1, idx));
    steps.forEach((s, i) => s.classList.toggle('is-active', i === current));
    dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === current);
      d.classList.toggle('is-done', i < current);
    });
  };

  const val = (id) => {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  };

  const validateStep = () => {
    if (current === 0) {
      if (!val('serverName').trim()) { toast('Please name your server.', 'error'); return false; }
    }
    if (current === 1) {
      if (!val('adminUser').trim()) { toast('Choose an admin username.', 'error'); return false; }
      if (String(val('adminPass')).length < 6) { toast('Password must be at least 6 characters.', 'error'); return false; }
    }
    return true;
  };

  const renderReview = () => {
    const review = document.getElementById('reviewList');
    if (!review) return;
    const rows = [
      ['Server name', val('serverName')],
      ['Game mode', val('gamemode')],
      ['Difficulty', val('difficulty')],
      ['Max players', val('maxPlayers')],
      ['Port', val('port')],
      ['Require Xbox login', val('onlineMode') ? 'Yes' : 'No'],
      ['Use allowlist', val('allowList') ? 'Yes' : 'No'],
      ['Admin user', val('adminUser')],
    ];
    review.innerHTML = rows.map(([k, v]) =>
      `<div class="dc-review-row"><span>${k}</span><strong>${escapeHtml(String(v))}</strong></div>`
    ).join('');
  };

  wizard.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => {
    if (!validateStep()) return;
    if (current === 1) renderReview();
    show(current + 1);
  }));
  wizard.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => show(current - 1)));

  const finishBtn = document.getElementById('finishSetup');
  finishBtn?.addEventListener('click', async () => {
    const restore = withButtonSpinner(finishBtn, 'Launching…');
    try {
      const data = await apiFetch('/setup', {
        method: 'POST',
        body: {
          username: val('adminUser').trim(),
          password: val('adminPass'),
          startServer: true,
          server: {
            serverName: val('serverName').trim(),
            gamemode: val('gamemode'),
            difficulty: val('difficulty'),
            maxPlayers: val('maxPlayers'),
            port: val('port'),
            onlineMode: val('onlineMode') ? 'true' : 'false',
            allowList: val('allowList') ? 'true' : 'false',
          },
        },
      });
      setToken(data.token, data.username);
      if (data.startError) {
        toast(`Server created, but couldn't start automatically: ${data.startError}`, 'warn', 6000);
      } else {
        toast('Server launched! Redirecting…', 'success');
      }
      setTimeout(() => { location.href = 'index.html'; }, 900);
    } catch (err) {
      toast(err.message, 'error');
      restore();
    }
  });

  show(0);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
