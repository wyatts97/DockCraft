/**
 * modal.js — confirmation dialog used for all destructive actions.
 *
 * Per AGENTS.md, every destructive action (stop server, restore backup, delete
 * pack, remove player) must require explicit confirmation describing what will
 * happen. Returns a Promise<boolean>.
 *
 * Also exports detailModal for rich content popups (marketplace add-on
 * descriptions) where the content includes HTML from a trusted third party
 * (CurseForge). The title and metadata are still escaped; only the explicit
 * `descriptionHtml` field is treated as trusted HTML.
 */

import { escapeHtml } from './utils';

export function confirmModal({
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dc-modal-overlay';
    overlay.innerHTML = `
      <div class="dc-modal" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMsg">
        <h3 class="dc-modal-title" id="confirmTitle">${escapeHtml(title)}</h3>
        <p class="dc-modal-msg" id="confirmMsg">${escapeHtml(message)}</p>
        <div class="dc-modal-actions">
          <button class="btn btn--ghost" data-cancel>${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('is-in');
      const confirmBtn = overlay.querySelector('[data-confirm]');
      if (confirmBtn) confirmBtn.focus();
    });

    const close = (result) => {
      overlay.classList.remove('is-in');
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
      // Simple focus trap: Tab cycles between cancel and confirm.
      if (e.key === 'Tab') {
        const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    overlay.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-confirm]').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
  });
}

/**
 * Rich content modal for marketplace add-on detail pages.
 *
 * @param {object} opts
 * @param {string} opts.title      — pack name (escaped)
 * @param {string} opts.meta       — byline, e.g. "by FoxyNoTail · 1.2.0 · 25.9 MB" (escaped)
 * @param {string} opts.summary     — short summary (escaped)
 * @param {string} opts.descriptionHtml — full description, rendered as HTML. The
 *   caller is responsible for trusting this source — typically only
 *   third-party content like the CurseForge API where the user clicked
 *   through to a specific pack. Tags inside the rendered description are
 *   styled via `.dc-mkt-detail-body` in the SCSS.
 * @param {string} [opts.tags]     — comma-separated tag list to render as pills
 * @param {string} [opts.closeText] — text for the dismiss button
 */
export function detailModal({
  title,
  meta,
  summary,
  descriptionHtml,
  tags,
  closeText = 'Close',
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dc-modal-overlay dc-modal-overlay--wide';
    const tagsHtml = tags
      ? `<div class="dc-mkt-detail-tags">${tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => `<span class="dc-pill">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    overlay.innerHTML = `
      <div class="dc-modal dc-modal--wide" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
        <button class="dc-modal-close" type="button" aria-label="Close" data-close>×</button>
        <h3 class="dc-modal-title" id="detailTitle">${escapeHtml(title)}</h3>
        <div class="dc-modal-meta">${escapeHtml(meta || '')}</div>
        ${summary ? `<p class="dc-modal-summary">${escapeHtml(summary)}</p>` : ''}
        ${tagsHtml}
        <div class="dc-mkt-detail-body">${descriptionHtml || ''}</div>
        <div class="dc-modal-actions">
          <button class="btn btn--primary" type="button" data-close>${escapeHtml(closeText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('is-in');
      const closeBtn = overlay.querySelector('[data-close]');
      if (closeBtn) closeBtn.focus();
    });

    const close = () => {
      overlay.classList.remove('is-in');
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      // Focus trap: keep Tab inside the modal.
      if (e.key === 'Tab') {
        const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
  });
}
