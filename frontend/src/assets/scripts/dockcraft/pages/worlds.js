/**
 * worlds.js — world info, backups (create/restore/download/delete), upload.
 *
 * Restore and upload stop the server first (handled server-side); the UI warns
 * the user before destructive operations.
 */

import { apiFetch, toast, escapeHtml, withButtonSpinner } from '../api';
import { confirmModal } from '../modal';

export async function init() {
  await Promise.all([loadWorlds(), loadBackups()]);

  document.getElementById('backupBtn')?.addEventListener('click', onBackup);

  const drop = document.getElementById('worldDrop');
  const fileInput = document.getElementById('worldFile');
  if (drop && fileInput) {
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-drag');
      if (e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) onUpload(fileInput.files[0]); });
  }
}

async function loadWorlds() {
  const el = document.getElementById('worldInfo');
  if (!el) return;
  try {
    const data = await apiFetch('/worlds');
    if (!data.worlds.length) {
      el.innerHTML = `<div class="dc-empty-cell">No world found yet. Start the server once to generate it.</div>`;
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

function fmtSize(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

function renderBackups(backups) {
  const tbody = document.getElementById('backupsBody');
  if (!tbody) return;
  const last = document.getElementById('lastBackup');
  if (last) last.textContent = backups[0] ? new Date(backups[0].createdAt).toLocaleString() : 'Never';
  if (!backups.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="dc-empty-cell">No backups yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = backups.map((b) => `
    <tr>
      <td class="cell-name">${escapeHtml(b.filename)}</td>
      <td class="cell-date">${new Date(b.createdAt).toLocaleString()} · ${fmtSize(b.size)}</td>
      <td style="text-align:right; white-space:nowrap">
        <a class="btn btn--ghost btn--sm" href="/api/worlds/backups/${encodeURIComponent(b.filename)}/download">Download</a>
        <button class="btn btn--ghost btn--sm" data-restore="${escapeHtml(b.filename)}">Restore</button>
        <button class="btn btn--ghost btn--sm" data-delete="${escapeHtml(b.filename)}">Delete</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', () => onRestore(b.getAttribute('data-restore'))));
  tbody.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', () => onDelete(b.getAttribute('data-delete'))));
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

async function onDelete(filename) {
  const confirmed = await confirmModal({
    title: 'Delete this backup?',
    message: 'The backup file will be permanently removed.',
    confirmText: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/worlds/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    toast('Backup deleted.', 'success');
    await loadBackups();
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
