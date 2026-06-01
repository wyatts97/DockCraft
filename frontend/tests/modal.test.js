/**
 * tests/modal.test.js — confirmModal: focus trap, escape, click handlers.
 */

import { describe, it, expect } from 'vitest';
import { confirmModal } from '../src/assets/scripts/dockcraft/modal.js';

function fire(target, type, init = {}) {
  const ev = new (type.startsWith('key') ? KeyboardEvent : MouseEvent)(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe('confirmModal', () => {
  it('resolves true when the confirm button is clicked', async () => {
    const p = confirmModal({ title: 'Stop server?', message: 'Players will be kicked.' });
    // Wait a microtask for the requestAnimationFrame to attach focus.
    await new Promise((r) => setTimeout(r, 0));
    const confirmBtn = document.querySelector('[data-confirm]');
    confirmBtn.click();
    const result = await p;
    expect(result).toBe(true);
    // The overlay is removed on a 180ms delay to allow the fade-out animation.
    await new Promise((r) => setTimeout(r, 250));
    expect(document.querySelector('.dc-modal-overlay')).toBeNull();
  });

  it('resolves false when the cancel button is clicked', async () => {
    const p = confirmModal({ title: 'X' });
    await new Promise((r) => setTimeout(r, 0));
    document.querySelector('[data-cancel]').click();
    expect(await p).toBe(false);
  });

  it('resolves false when Escape is pressed', async () => {
    const p = confirmModal({ title: 'X' });
    await new Promise((r) => setTimeout(r, 0));
    fire(document, 'keydown', { key: 'Escape' });
    expect(await p).toBe(false);
  });

  it('resolves true when Enter is pressed', async () => {
    const p = confirmModal({ title: 'X' });
    await new Promise((r) => setTimeout(r, 0));
    fire(document, 'keydown', { key: 'Enter' });
    expect(await p).toBe(true);
  });

  it('uses the danger class when danger=true', async () => {
    const p = confirmModal({ title: 'Delete', danger: true });
    await new Promise((r) => setTimeout(r, 0));
    const btn = document.querySelector('[data-confirm]');
    expect(btn.className).toContain('btn--danger');
    // Click to clean up.
    btn.click();
    await p;
  });

  it('renders a dialog with proper ARIA roles', async () => {
    const p = confirmModal({ title: 'Confirm?' });
    await new Promise((r) => setTimeout(r, 0));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('confirmTitle');
    expect(dialog.getAttribute('aria-describedby')).toBe('confirmMsg');
    // Cleanup
    document.querySelector('[data-cancel]').click();
    await p;
  });

  it('escapes the title and message to prevent XSS', async () => {
    const p = confirmModal({ title: '<script>alert(1)</script>', message: '<img src=x onerror=alert(1)>' });
    await new Promise((r) => setTimeout(r, 0));
    const html = document.querySelector('.dc-modal').innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    document.querySelector('[data-cancel]').click();
    await p;
  });
});
