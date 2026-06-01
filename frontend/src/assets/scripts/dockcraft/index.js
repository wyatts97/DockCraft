/**
 * index.js (dockcraft) — page dispatcher.
 *
 * Runs after the Adminator shell mounts. Reads <body data-page="…"> and runs
 * the matching page module, after enforcing the setup/auth guard. Also wires
 * the shared logout control and the current user's name into the chrome.
 */

import { guard, clearToken, getUser } from './api';
import { confirmModal } from './modal';
import { mountShell } from '../2026/Shell.js';
import { initShellBehaviors } from '../2026/init.js';

import * as dashboard from './pages/dashboard';
import * as consolePage from './pages/console';
import * as players from './pages/players';
import * as mods from './pages/mods';
import * as marketplace from './pages/marketplace';
import * as worlds from './pages/worlds';
import * as settings from './pages/settings';
import * as setup from './pages/setup';
import * as login from './pages/login';

const PAGES = {
  dashboard, console: consolePage, players, mods, marketplace, worlds, settings, setup, login,
};

// Pages that are part of the auth flow and should not redirect on themselves.
const AUTH_PAGES = { login: 'login', setup: 'setup' };

let currentDestroy = null;

export async function initDockCraft() {
  const page = document.body.getAttribute('data-page');
  if (!page || !PAGES[page]) return;

  // Clean up the previous page before mounting the new one.
  if (currentDestroy) {
    try { currentDestroy(); } catch (err) { console.error('[dockcraft] destroy error:', err); }
    currentDestroy = null;
  }

  const guardOpt = AUTH_PAGES[page] ? { page: AUTH_PAGES[page] } : {};
  const allowed = await guard(guardOpt);
  if (!allowed) return; // a redirect is in progress

  wireChrome();

  try {
    await PAGES[page].init();
    currentDestroy = PAGES[page].destroy || null;
  } catch (err) {
    console.error(`[dockcraft] page "${page}" failed to init:`, err);
  }
}

function wireChrome() {
  const user = getUser();
  if (user) {
    document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = user; });
    document.querySelectorAll('[data-user-initials]').forEach((el) => {
      el.textContent = user.slice(0, 2).toUpperCase();
    });
  }

  document.querySelectorAll('[data-logout]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const confirmed = await confirmModal({
        title: 'Sign out?',
        message: 'You will need to sign in again to manage your server.',
        confirmText: 'Sign out',
      });
      if (!confirmed) return;
      clearToken();
      location.href = 'login.html';
    });
  });
}

/* ---------- SPA router ---------- */

export async function navigateTo(url, { push = true } = {}) {
  const currentFile = location.pathname.split('/').pop() || 'index.html';
  if (url === currentFile && push) return;

  try {
    const resp = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const newMain = doc.querySelector('main.content');
    if (!newMain) throw new Error('No main.content found in fetched page');

    const currentMain = document.querySelector('main.content');
    if (currentMain) currentMain.innerHTML = newMain.innerHTML;

    const newBody = doc.body;
    document.body.setAttribute('data-page', newBody.getAttribute('data-page') || '');
    document.body.setAttribute('data-active', newBody.getAttribute('data-active') || '');
    document.body.setAttribute('data-crumbs', newBody.getAttribute('data-crumbs') || '');
    document.title = doc.title;

    if (push) history.pushState({}, doc.title, url);

    mountShell();
    initShellBehaviors();
    await initDockCraft();
  } catch (err) {
    console.error('[router] SPA navigation failed, falling back to full reload:', err);
    location.href = url;
  }
}

export function initRouter() {
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const link = target && target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#') || href.startsWith('javascript:')) return;
    if (/^https?:\/\//.test(href)) return;

    e.preventDefault();
    navigateTo(href);
  });

  window.addEventListener('popstate', () => {
    navigateTo(location.pathname.split('/').pop() || 'index.html', { push: false });
  });
}
