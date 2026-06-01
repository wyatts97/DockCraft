/**
 * modal.js — confirmation dialog used for all destructive actions.
 *
 * Per AGENTS.md, every destructive action (stop server, restore backup, delete
 * pack, remove player) must require explicit confirmation describing what will
 * happen. Returns a Promise<boolean>.
 */

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
      <div class="dc-modal" role="dialog" aria-modal="true">
        <h3 class="dc-modal-title">${escape(title)}</h3>
        <p class="dc-modal-msg">${escape(message)}</p>
        <div class="dc-modal-actions">
          <button class="btn btn--ghost" data-cancel>${escape(cancelText)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${escape(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-in'));

    const close = (result) => {
      overlay.classList.remove('is-in');
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    overlay.querySelector('[data-cancel]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-confirm]').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
  });
}

function escape(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
