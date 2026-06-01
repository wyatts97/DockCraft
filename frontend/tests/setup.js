/**
 * tests/setup.js — runs before every test file.
 *
 * Provides a clean DOM (jsdom) with a stub `localStorage` that's been
 * pre-seeded with no DockCraft state. Tests should reset it in `beforeEach`
 * if they need a clean slate.
 */

import { vi, beforeEach } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
});

export { vi };
