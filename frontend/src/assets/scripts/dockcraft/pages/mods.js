/**
 * mods.js — installed pack manager.
 *
 * Lists installed behavior/resource packs as cards with enable/disable toggles,
 * supports drag-and-drop upload of .mcaddon/.mcpack, and delete with confirm.
 * Changes prompt the user to restart the server to take effect.
 */

import { apiFetch, toast, escapeHtml } from '../api';
import { confirmModal } from '../modal';

export async function init() {
  await loadMods();

  const drop = document.getElementById('modDrop');
  const fileInput = document.getElementById('modFile');
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

async function loadMods() {
  const grid = document.getElementById('modsGrid');
  if (!grid) return;
  grid.innerHTML = `<div class="dc-empty-cell">Loading…</div>`;
  try {
    const data = await apiFetch('/mods');
    renderMods(data.mods);
  } catch (err) {
    grid.innerHTML = `<div class="dc-empty-cell">${escapeHtml(err.message)}</div>`;
  }
}

function renderMods(mods) {
  const grid = document.getElementById('modsGrid');
  if (!grid) return;
  if (!mods.length) {
    grid.innerHTML = `
      <div class="dc-empty-state">
        <div class="dc-empty-title">No mods installed yet</div>
        <p>Upload a pack above, or browse the <a href="marketplace.html">Marketplace</a> to find add-ons.</p>
      </div>`;
    return;
  }
  grid.innerHTML = mods.map((m) => `
    <div class="dc-mod-card ${m.enabled ? 'is-enabled' : ''}">
      <div class="dc-mod-head">
        <span class="tag ${m.type === 'resource' ? 't-info' : 't-new'}">${m.type}</span>
        <label class="dc-switch">
          <input type="checkbox" data-toggle="${escapeHtml(m.uuid)}" ${m.enabled ? 'checked' : ''}>
          <span class="dc-switch-track"></span>
        </label>
      </div>
      <div class="dc-mod-name">${escapeHtml(m.name)}</div>
      <div class="dc-mod-desc">${escapeHtml(m.description || 'No description provided.')}</div>
      <div class="dc-mod-foot">
        <span class="cell-date">v${Array.isArray(m.version) ? m.version.join('.') : m.version}</span>
        <button class="btn btn--ghost btn--sm" data-delete="${escapeHtml(m.uuid)}" data-name="${escapeHtml(m.name)}">Delete</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-toggle]').forEach((cb) =>
    cb.addEventListener('change', () => onToggle(cb.getAttribute('data-toggle'))));
  grid.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', () => onDelete(b.getAttribute('data-delete'), b.getAttribute('data-name'))));
}

async function onToggle(uuid) {
  try {
    const data = await apiFetch(`/mods/${encodeURIComponent(uuid)}/toggle`, { method: 'PUT' });
    toast(`Pack ${data.enabled ? 'enabled' : 'disabled'}. Restart the server to apply.`, 'success');
    await loadMods();
  } catch (err) {
    toast(err.message, 'error');
    await loadMods();
  }
}

async function onDelete(uuid, name) {
  const confirmed = await confirmModal({
    title: `Delete "${name}"?`,
    message: 'The pack files will be removed from the server. This cannot be undone.',
    confirmText: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/mods/${encodeURIComponent(uuid)}`, { method: 'DELETE' });
    toast('Pack deleted. Restart the server to apply.', 'success');
    await loadMods();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onUpload(file) {
  const fd = new FormData();
  fd.append('pack', file);
  try {
    toast(`Installing ${file.name}…`, 'info');
    await apiFetch('/mods/upload', { method: 'POST', body: fd });
    toast('Pack installed. Restart the server to apply.', 'success');
    await loadMods();
  } catch (err) {
    toast(err.message, 'error');
  }
}
