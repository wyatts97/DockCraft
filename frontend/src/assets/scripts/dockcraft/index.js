/**
 * index.js (dockcraft) — page dispatcher.
 *
 * Runs after the Adminator shell mounts. Reads <body data-page="…"> and runs
 * the matching page module, after enforcing the setup/auth guard. Also wires
 * the shared logout control and the current user's name into the chrome.
 */

import { guard, clearToken, getUser } from './api';
import { confirmModal } from './modal';

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

export async function initDockCraft() {
  const page = document.body.getAttribute('data-page');
  if (!page || !PAGES[page]) return;

  const guardOpt = AUTH_PAGES[page] ? { page: AUTH_PAGES[page] } : {};
  const allowed = await guard(guardOpt);
  if (!allowed) return; // a redirect is in progress

  wireChrome();

  try {
    await PAGES[page].init();
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
