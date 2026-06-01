/**
 * whatsNew.js — version changelog popover in the footer.
 *
 * Pulls the running version from /api/system/version and shows a small
 * popover with a curated changelog entry for that version. The popover only
 * auto-opens the first time a user sees a new version (tracked in
 * localStorage under `dockcraft-last-seen-version`); afterwards the user
 * opens it manually by clicking the version label in the footer.
 *
 * Why a separate file: the popover needs version-aware state and DOM, and
 * the existing Shell.js is concerned only with the chrome layout.
 */

import { apiFetch } from './api';
import { escapeHtml } from './utils';

const STORAGE_KEY = 'dockcraft-last-seen-version';

const CHANGELOG = {
  '1.0.0': {
    title: 'Welcome to DockCraft',
    items: [
      'Run a Minecraft Bedrock server in Docker with no terminal required.',
      'Install mods and resource packs from the bundled marketplace.',
      'Manage allowlist, permissions, and bans from the Players page.',
      'Back up and restore worlds with one click.',
    ],
  },
};

function changelogFor(version) {
  // Walk backwards from the running version; show the most recent entry
  // that exists in the registry. Falls back to a generic welcome.
  const known = Object.keys(CHANGELOG).sort().reverse();
  for (const v of known) {
    if (version && version.localeCompare(v, undefined, { numeric: true }) >= 0) {
      return { version: v, ...CHANGELOG[v] };
    }
  }
  return { version: '1.0.0', ...CHANGELOG['1.0.0'] };
}

function renderPopoverHtml(entry) {
  return `<div class="dc-whats-new" id="dcWhatsNew">
    <button type="button" class="dc-whats-new-btn" id="dcWhatsNewBtn"
      aria-haspopup="dialog" aria-expanded="false" aria-controls="dcWhatsNewPop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/>
      </svg>
      <span class="dc-version-tag" data-app-version>v${escapeHtml(entry.version)}</span>
    </button>
    <div class="dc-whats-new-pop" id="dcWhatsNewPop" role="dialog" aria-labelledby="dcWhatsNewTitle" hidden>
      <h3 id="dcWhatsNewTitle">${escapeHtml(entry.title)}</h3>
      <p class="dc-pop-sub">What's new in v${escapeHtml(entry.version)}</p>
      <ul>${entry.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</ul>
    </div>
  </div>`;
}

function bindPopover(root) {
  const btn = root.querySelector('#dcWhatsNewBtn');
  const pop = root.querySelector('#dcWhatsNewPop');
  if (!btn || !pop) return;
  const setOpen = (on) => {
    root.classList.toggle('is-open', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    pop.hidden = !on;
    if (on) {
      // Mark as seen so we don't auto-pop next time.
      try { localStorage.setItem(STORAGE_KEY, btn.querySelector('[data-app-version]')?.textContent || ''); } catch { /* private mode — no-op */ }
    }
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!root.classList.contains('is-open'));
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-open')) {
      setOpen(false);
      btn.focus();
    }
  });
}

export async function initWhatsNew() {
  const host = document.querySelector('[data-shell-footer]');
  if (!host) return;
  // Default to the latest known version, then patch the label once we know
  // the running version. This avoids a flash of the placeholder on slow boots.
  const entry = changelogFor(null);
  host.insertAdjacentHTML('beforeend', renderPopoverHtml(entry));
  const root = document.getElementById('dcWhatsNew');
  bindPopover(root);

  let version = null;
  try {
    const d = await apiFetch('/system/version');
    version = d.version;
  } catch { /* leave default */ }
  if (!version) return;

  const e = changelogFor(version);
  const tagEl = root.querySelector('[data-app-version]');
  if (tagEl) tagEl.textContent = `v${e.version}`;
  const titleEl = root.querySelector('#dcWhatsNewTitle');
  if (titleEl) titleEl.textContent = e.title;
  const subEl = root.querySelector('.dc-pop-sub');
  if (subEl) subEl.textContent = `What's new in v${e.version}`;
  const listEl = root.querySelector('.dc-whats-new-pop ul');
  if (listEl) listEl.innerHTML = e.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('');

  // First-time visit: open automatically.
  let last = null;
  try { last = localStorage.getItem(STORAGE_KEY); } catch { /* private mode — no-op */ }
  if (last !== `v${e.version}`) {
    root.classList.add('is-open');
    root.querySelector('#dcWhatsNewBtn')?.setAttribute('aria-expanded', 'true');
    root.querySelector('#dcWhatsNewPop').hidden = false;
  }
}
