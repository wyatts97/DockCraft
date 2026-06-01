/**
 * tests/modal.test.js — confirmModal: focus trap, escape, click handlers.
 *                    — detailModal: HTML rendering, close, escape, focus trap.
 */

import { describe, it, expect } from 'vitest';
import { confirmModal, detailModal } from '../src/assets/scripts/dockcraft/modal.js';

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

describe('detailModal', () => {
  it('renders the title, summary, and HTML description', async () => {
    const p = detailModal({
      title: 'Core Craft',
      meta: 'by FoxyNoTail · 1.2.0 · 25 MB',
      summary: 'A vanilla+ expansion.',
      descriptionHtml: '<h2>Update</h2><p>Now with <strong>iron golems</strong>.</p><ul><li>Variant 1</li></ul>',
      tags: 'survival, vanilla',
    });
    await new Promise((r) => setTimeout(r, 0));
    const modal = document.querySelector('.dc-modal--wide');
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Core Craft');
    expect(modal.textContent).toContain('FoxyNoTail');
    expect(modal.textContent).toContain('A vanilla+ expansion.');
    // The HTML body should contain the actual tags, not escaped.
    const body = modal.querySelector('.dc-mkt-detail-body');
    expect(body.querySelector('h2')).toBeTruthy();
    expect(body.querySelector('strong')).toBeTruthy();
    expect(body.querySelector('ul li').textContent).toBe('Variant 1');
    // Tags render as pills.
    const pills = modal.querySelectorAll('.dc-mkt-detail-tags .dc-pill');
    expect(pills.length).toBe(2);
    expect(pills[0].textContent).toBe('survival');
    expect(pills[1].textContent).toBe('vanilla');
    document.querySelector('.dc-modal--wide [data-close]').click();
    await p;
  });

  it('escapes the title and summary but renders descriptionHtml as HTML', async () => {
    const p = detailModal({
      title: '<script>alert(1)</script>',
      summary: '<img src=x onerror=alert(1)>',
      descriptionHtml: '<p>Trusted HTML <strong>here</strong>.</p>',
    });
    await new Promise((r) => setTimeout(r, 0));
    const modal = document.querySelector('.dc-modal--wide');
    // Title is escaped
    expect(modal.innerHTML).not.toContain('<script>alert(1)</script>');
    expect(modal.textContent).toContain('<script>alert(1)</script>');
    // Summary is escaped
    expect(modal.querySelector('.dc-modal-summary').innerHTML).toContain('&lt;img');
    // Description is rendered as HTML
    expect(modal.querySelector('.dc-mkt-detail-body strong').textContent).toBe('here');
    document.querySelector('.dc-modal--wide [data-close]').click();
    await p;
  });

  it('closes on Escape and overlay click', async () => {
    const p1 = detailModal({ title: 'X' });
    await new Promise((r) => setTimeout(r, 0));
    fire(document, 'keydown', { key: 'Escape' });
    await p1;
    // Fade-out is 180ms before the overlay is removed.
    await new Promise((r) => setTimeout(r, 220));
    expect(document.querySelector('.dc-modal--wide')).toBeNull();

    const p2 = detailModal({ title: 'X' });
    await new Promise((r) => setTimeout(r, 0));
    const overlay = document.querySelector('.dc-modal-overlay--wide');
    fire(overlay, 'click');
    await p2;
    await new Promise((r) => setTimeout(r, 220));
    expect(document.querySelector('.dc-modal--wide')).toBeNull();
  });

  it('exposes a close button in the corner', async () => {
    const p = detailModal({ title: 'X' });
    await new Promise((r) => setTimeout(r, 0));
    const corners = document.querySelectorAll('.dc-modal-close');
    expect(corners.length).toBeGreaterThan(0);
    corners[0].click();
    await p;
    await new Promise((r) => setTimeout(r, 220));
    expect(document.querySelector('.dc-modal--wide')).toBeNull();
  });
});
