/**
 * setup.js — first-run wizard.
 *
 * Three steps: server basics -> network & admin account -> review & launch.
 * On finish, POSTs /api/setup which creates the admin account, saves the env
 * config, optionally starts the container, and returns a JWT.
 *
 * Persists the in-progress draft to localStorage (`dockcraft-setup-draft`) so
 * a user who closes the tab mid-setup can resume from the same step.
 */

import { apiFetch, setToken, toast, withButtonSpinner } from '../api';
import { escapeHtml } from '../utils';

const DRAFT_KEY = 'dockcraft-setup-draft';
let lastRenderedStep = -1;

const DRAFT_FIELDS = ['serverName', 'gamemode', 'difficulty', 'maxPlayers', 'port', 'adminUser', 'adminPass'];
const DRAFT_BOOLS  = ['onlineMode', 'allowList'];

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveDraft() {
  const draft = { step: currentStep };
  for (const f of DRAFT_FIELDS) {
    const el = document.getElementById(f);
    if (el) draft[f] = el.value;
  }
  for (const f of DRAFT_BOOLS) {
    const el = document.getElementById(f);
    if (el) draft[f] = el.checked;
  }
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
}

function applyDraft(draft) {
  if (!draft) return;
  for (const f of DRAFT_FIELDS) {
    const el = document.getElementById(f);
    if (el && draft[f] != null) el.value = draft[f];
  }
  for (const f of DRAFT_BOOLS) {
    const el = document.getElementById(f);
    if (el && typeof draft[f] === 'boolean') {
      el.checked = draft[f];
      el.setAttribute('aria-checked', draft[f] ? 'true' : 'false');
    }
  }
}

let currentStep = 0;

export async function init() {
  const wizard = document.getElementById('setupWizard');
  if (!wizard) return;

  // Restore draft before wiring any handlers so the first 'change' event
  // saves it back correctly.
  const draft = loadDraft();
  if (draft) applyDraft(draft);

  const steps = Array.from(wizard.querySelectorAll('[data-step]'));
  const dots = Array.from(wizard.querySelectorAll('[data-dot]'));

  const show = (idx) => {
    currentStep = Math.max(0, Math.min(steps.length - 1, idx));
    steps.forEach((s, i) => {
      const on = i === currentStep;
      s.classList.toggle('is-active', on);
      if (on) s.removeAttribute('hidden'); else s.setAttribute('hidden', '');
    });
    dots.forEach((d, i) => {
      const on = i === currentStep;
      d.classList.toggle('is-active', on);
      d.classList.toggle('is-done', i < currentStep);
      d.setAttribute('aria-current', on ? 'step' : 'false');
      d.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // Move keyboard focus to the first input of the new step.
    const first = steps[currentStep]?.querySelector('input, select, button');
    if (first) first.focus({ preventScroll: true });
    saveDraft();
  };

  const val = (id) => {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  };

  const validateStep = () => {
    if (currentStep === 0) {
      if (!val('serverName').trim()) { toast('Please name your server.', 'error'); return false; }
    }
    if (currentStep === 1) {
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
    lastRenderedStep = 1;
  };

  wizard.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => {
    if (!validateStep()) return;
    if (currentStep === 1 || lastRenderedStep !== 1) renderReview();
    show(currentStep + 1);
  }));
  wizard.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => show(currentStep - 1)));

  // Persist on every change.
  [...DRAFT_FIELDS, ...DRAFT_BOOLS].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', saveDraft);
    if (el && el.type === 'checkbox') el.addEventListener('change', saveDraft);
  });

  // Update the port hint when the user picks a non-default value.
  const portEl = document.getElementById('port');
  const portHint = document.getElementById('portHint');
  if (portEl && portHint) {
    const updatePortHint = () => {
      if (parseInt(portEl.value, 10) !== 19132) {
        portHint.textContent = 'Non-default port. Friends must add the port after the IP in Bedrock\'s server browser.';
        portHint.classList.add('dc-field-hint--warn');
      } else {
        portHint.textContent = 'Default 19132 is what Bedrock clients look for. Change only if you have a port conflict.';
        portHint.classList.remove('dc-field-hint--warn');
      }
    };
    portEl.addEventListener('input', updatePortHint);
    updatePortHint();
  }

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
      clearDraft();
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

  // Resume at the saved step (clamped in case fields were removed).
  const startAt = Math.max(0, Math.min(steps.length - 1, parseInt(draft?.step, 10) || 0));
  show(startAt);
}

export function destroy() {
  lastRenderedStep = -1;
  currentStep = 0;
}
