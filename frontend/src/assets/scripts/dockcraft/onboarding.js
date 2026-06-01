/**
 * onboarding.js — first-run welcome banner with quick-start checklist.
 *
 * Shows a 3-step checklist on the dashboard until the user either:
 *   - dismisses it, or
 *   - completes all three steps.
 *
 * State persists in localStorage under `dockcraft-onboarding`. The banner
 * is independent of the dashboard page module so its lifecycle is tied to
 * the page mount (init() called from index.js dispatcher).
 *
 * Steps:
 *   1. Start your server        — fires POST /api/server/start (with confirm).
 *   2. Copy your server address — copies "host:port" to clipboard.
 *   3. Invite a friend          — links to the Players page.
 */

import { apiFetch, toast, withButtonSpinner } from './api';
import { escapeHtml } from './utils';

const STORAGE_KEY = 'dockcraft-onboarding';

const DEFAULT_STATE = {
  dismissed: false,
  started: false,
  copied: false,
  invited: false,
  completedAt: null,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_STATE }; }
}

function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

function allDone(s) { return s.started && s.copied && s.invited; }

function hostFromLocation() {
  return location.hostname || 'localhost';
}

function renderHtml(state) {
  const host = hostFromLocation();
  const port = (state.port || 19132);
  const addr = `${host}:${port}`;

  const item = (id, label, done, cta) => `
    <li class="dc-welcome-item ${done ? 'is-done' : ''}" data-step="${id}">
      <button class="dc-welcome-check" type="button" role="checkbox" aria-checked="${done ? 'true' : 'false'}" aria-label="Mark '${escapeHtml(label)}' as done" data-mark="${id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 8"/></svg>
      </button>
      <span class="dc-welcome-label">${escapeHtml(label)}</span>
      <div class="dc-welcome-actions">${cta}</div>
    </li>`;

  const ctaStart = state.started
    ? '<span class="dc-welcome-cta">Started ✓</span>'
    : '<button class="btn btn--primary btn--sm" type="button" data-action="start">Start server</button>';
  const ctaCopy = state.copied
    ? '<span class="dc-welcome-cta">Copied ✓</span>'
    : `<button class="btn btn--ghost btn--sm" type="button" data-action="copy" data-addr="${escapeHtml(addr)}">Copy address</button>`;
  const ctaInvite = state.invited
    ? '<span class="dc-welcome-cta">Invited ✓</span>'
    : '<a class="btn btn--ghost btn--sm" href="players.html" data-action="invite">Open Players</a>';

  return `
    <section class="dc-welcome" id="dcWelcome" aria-label="Quick-start checklist">
      <div class="dc-welcome-body">
        <h2 class="dc-welcome-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l14 9-14 9z"/></svg>
          Your server is ready — let's get your first player in.
        </h2>
        <p class="dc-welcome-sub">Three quick steps to share your server with a friend. Tick them off as you go.</p>
        <ul class="dc-welcome-list">
          ${item('started', 'Start your server', state.started, ctaStart)}
          ${item('copied',   'Copy your server address', state.copied, ctaCopy)}
          ${item('invited',  'Invite a friend from the Players page', state.invited, ctaInvite)}
        </ul>
      </div>
      <aside class="dc-welcome-aside">
        <h3>Want friends outside your home network?</h3>
        <p>The Bedrock server uses UDP port <strong>${port}</strong>. Most home routers block inbound traffic by default — you'll need to set up port forwarding or use a tunneling service like playit.gg.</p>
        <button class="dc-welcome-dismiss" type="button" data-dismiss>Hide this checklist</button>
      </aside>
    </section>`;
}

function bind(root, state, hooks) {
  root.querySelector('[data-dismiss]')?.addEventListener('click', () => {
    state.dismissed = true;
    state.completedAt = state.completedAt || new Date().toISOString();
    saveState(state);
    root.style.display = 'none';
    toast('Welcome checklist hidden. You can always revisit the Help drawer for guidance.', 'info');
  });

  // Per-step mark-as-done (the round checkbox). Doesn't trigger the side action —
  // it just toggles the visual state. Useful if a user did the step elsewhere.
  root.querySelectorAll('[data-mark]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-mark');
      if (key === 'started') state.started = !state.started;
      else if (key === 'copied') state.copied = !state.copied;
      else if (key === 'invited') state.invited = !state.invited;
      saveState(state);
      hooks.refresh();
    });
  });

  root.querySelector('[data-action="start"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const restore = withButtonSpinner(btn, 'Starting…');
    try {
      await apiFetch('/server/start', { method: 'POST' });
      state.started = true;
      saveState(state);
      hooks.refresh();
      toast('Server is starting up. Give it a minute on first launch.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      restore();
    }
  });

  root.querySelector('[data-action="copy"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const addr = btn.getAttribute('data-addr') || '';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(addr);
      } else {
        // Fallback for non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = addr; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      state.copied = true;
      saveState(state);
      hooks.refresh();
      toast(`Copied ${addr} to clipboard.`, 'success');
    } catch {
      toast('Could not copy automatically. Select the text and copy manually.', 'warn');
    }
  });

  root.querySelector('[data-action="invite"]')?.addEventListener('click', () => {
    // The click already navigates; mark done on the way out.
    state.invited = true;
    saveState(state);
  });
}

function mountOrRefresh(state) {
  const existing = document.getElementById('dcWelcome');
  const host = document.querySelector('.content');
  if (!host) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderHtml(state);
  const fresh = tmp.firstElementChild;
  if (existing) existing.replaceWith(fresh); else host.insertBefore(fresh, host.firstElementChild);
  bind(fresh, state, { refresh: () => mountOrRefresh(state) });
  if (allDone(state) && !state.completedAt) {
    state.completedAt = new Date().toISOString();
    saveState(state);
    toast('Nice — your server is set up end to end.', 'success', 4000);
    // Keep visible briefly so the user sees the final state, then hide.
    setTimeout(() => { fresh.style.display = 'none'; }, 1800);
  }
}

export async function initOnboarding() {
  if (document.body.getAttribute('data-page') !== 'dashboard') return;
  const state = loadState();
  if (state.dismissed) return; // user hid it, leave it hidden

  // Discover the actual port from settings so the copy-address step is accurate.
  try {
    const env = await apiFetch('/settings');
    if (env && env.env && env.env.SERVER_PORT) {
      const p = parseInt(env.env.SERVER_PORT, 10);
      if (p > 0) state.port = p;
    }
  } catch { /* defaults to 19132 */ }

  // Auto-mark "started" if the server is already running — most users open
  // the dashboard a second time after starting the server from the wizard.
  try {
    const s = await apiFetch('/server/status');
    if (s && s.running) state.started = true;
  } catch { /* leave default */ }

  mountOrRefresh(state);
}
