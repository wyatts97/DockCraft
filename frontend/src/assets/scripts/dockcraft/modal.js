/**
 * modal.js — confirmation dialog used for all destructive actions.
 *
 * Per AGENTS.md, every destructive action (stop server, restore backup, delete
 * pack, remove player) must require explicit confirmation describing what will
 * happen. Returns a Promise<boolean>.
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
