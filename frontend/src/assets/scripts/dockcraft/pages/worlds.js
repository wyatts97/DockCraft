/**
 * worlds.js — world info, backups (create/restore/download/delete), upload.
 *
 * Restore and upload stop the server first (handled server-side); the UI warns
 * the user before destructive operations.
 */

import { apiFetch, toast, withButtonSpinner } from '../api';
import { escapeHtml, formatSize, formatBackupName, emptyState } from '../utils';
import { confirmModal } from '../modal';

export async function init() {
  await Promise.all([loadWorlds(), loadBackups()]);

  document.getElementById('backupBtn')?.addEventListener('click', onBackup);

  const drop = document.getElementById('worldDrop');
  const fileInput = document.getElementById('worldFile');
  if (drop && fileInput) {
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('dragover', onDragOver);
    drop.addEventListener('dragleave', onDragLeave);
    drop.addEventListener('drop', onDrop);
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) onUpload(fileInput.files[0]); });
  }
}

// Drag enter/leave fire for every child transition; track a counter so the
// "is-drag" state only flips when the cursor actually leaves the drop zone.
let dragDepth = 0;
function onDragOver(e) {
  e.preventDefault();
  dragDepth += 1;
  document.getElementById('worldDrop')?.classList.add('is-drag');
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.getElementById('worldDrop')?.classList.remove('is-drag');
}
function onDrop(e) {
  e.preventDefault();
  dragDepth = 0;
  document.getElementById('worldDrop')?.classList.remove('is-drag');
  if (e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
}

export function destroy() {
  // Listeners were bound to DOM nodes that get replaced on SPA navigation;
  // they'll be garbage-collected with the old DOM. Nothing to do here.
  dragDepth = 0;
}

async function loadWorlds() {
  const el = document.getElementById('worldInfo');
  if (!el) return;
  try {
    const data = await apiFetch('/worlds');
    if (!data.worlds.length) {
      const empty = emptyState({
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
        title: 'No world found yet',
        message: 'Start the server once to generate the default world. It will appear here.',
      });
      el.innerHTML = empty.html;
      return;
    }
    el.innerHTML = data.worlds.map((w) => `
      <div class="dc-world-row">
        <div class="dc-world-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg></div>
        <div><div class="cell-name">${escapeHtml(w.name)}</div><div class="cell-date">Active world</div></div>
      </div>`).join('');
  } catch (err) {
    el.innerHTML = `<div class="dc-empty-cell">${escapeHtml(err.message)}</div>`;
  }
}

async function loadBackups() {
  const tbody = document.getElementById('backupsBody');
  if (!tbody) return;
  try {
    const data = await apiFetch('/worlds/backups');
    renderBackups(data.backups);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="dc-empty-cell">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderBackups(backups) {
  const tbody = document.getElementById('backupsBody');
  if (!tbody) return;
  const last = document.getElementById('lastBackup');
  if (last) last.textContent = backups[0] ? new Date(backups[0].createdAt).toLocaleString() : 'Never';
  if (!backups.length) {
    const empty = emptyState({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>',
      title: 'No backups yet',
      message: 'Create a backup before making major changes. Backups are stored on the host so you can restore if something goes wrong.',
      primaryCta: { label: 'Create first backup', onClick: onBackup },
    });
    tbody.innerHTML = `<tr><td colspan="3">${empty.html}</td></tr>`;
    empty.bind();
    return;
  }
  tbody.innerHTML = backups.map((b) => `
    <tr>
      <td class="cell-name" title="${escapeHtml(b.filename)}">${escapeHtml(formatBackupName(b.createdAt))}</td>
      <td class="cell-date">${formatSize(b.size)}</td>
      <td class="dc-row-actions">
        <button class="btn btn--ghost btn--sm" data-download="${escapeHtml(b.filename)}">Download</button>
        <button class="btn btn--ghost btn--sm" data-restore="${escapeHtml(b.filename)}">Restore</button>
        <button class="btn btn--ghost btn--sm" data-delete="${escapeHtml(b.filename)}">Delete</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-download]').forEach((b) =>
    b.addEventListener('click', () => onDownload(b.getAttribute('data-download'))));
  tbody.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', () => onRestore(b.getAttribute('data-restore'))));
  tbody.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', () => onDelete(b.getAttribute('data-delete'), b)));
}

async function onBackup() {
  const btn = document.getElementById('backupBtn');
  const restore = withButtonSpinner(btn, 'Backing up…');
  try {
    await apiFetch('/worlds/backup', { method: 'POST' });
    toast('Backup created.', 'success');
    await loadBackups();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

async function onRestore(filename) {
  const confirmed = await confirmModal({
    title: 'Restore this backup?',
    message: 'The server will be stopped, the current world replaced, then the server restarted. This cannot be undone.',
    confirmText: 'Restore',
    danger: true,
  });
  if (!confirmed) return;
  try {
    toast('Restoring… the server will restart.', 'info');
    await apiFetch('/worlds/restore', { method: 'POST', body: { filename } });
    toast('World restored.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onDelete(filename, btn) {
  const confirmed = await confirmModal({
    title: 'Delete this backup?',
    message: `The backup file "${filename}" will be permanently removed.`,
    confirmText: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  const restore = btn ? withButtonSpinner(btn, 'Deleting…') : () => {};
  try {
    await apiFetch(`/api/worlds/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    toast('Backup deleted.', 'success');
    await loadBackups();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

/**
 * Download a backup. We can't use a plain <a href> because the JWT lives in
 * the Authorization header — the browser would issue a 401. Fetch the file
 * with auth, then surface it as a temporary blob URL the user can save.
 */
async function onDownload(filename) {
  try {
    const res = await apiFetch(
      `/worlds/backups/${encodeURIComponent(filename)}/download`,
      { raw: true }
    );
    if (!res.ok) throw new Error(`Download failed (status ${res.status}).`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onUpload(file) {
  const confirmed = await confirmModal({
    title: 'Upload and replace world?',
    message: `The server will be stopped, the current world replaced with "${file.name}", then restarted.`,
    confirmText: 'Upload',
    danger: true,
  });
  if (!confirmed) return;
  const fd = new FormData();
  fd.append('world', file);
  try {
    toast('Uploading world… the server will restart.', 'info');
    await apiFetch('/worlds/upload', { method: 'POST', body: fd });
    toast('World uploaded.', 'success');
    await loadWorlds();
  } catch (err) {
    toast(err.message, 'error');
  }
}
