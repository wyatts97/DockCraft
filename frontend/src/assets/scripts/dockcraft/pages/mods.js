/**
 * mods.js — installed pack manager.
 *
 * Lists installed behavior/resource packs as cards with enable/disable toggles,
 * supports drag-and-drop upload of .mcaddon/.mcpack, and delete with confirm.
 * Changes prompt the user to restart the server to take effect.
 */

import { apiFetch, toast } from '../api';
import { escapeHtml, emptyState } from '../utils';
import { confirmModal } from '../modal';

let drop = null;
let fileInput = null;
let dropHandlers = null;

export async function init() {
  await loadMods();

  drop = document.getElementById('modDrop');
  fileInput = document.getElementById('modFile');
  if (drop && fileInput) {
    dropHandlers = {
      click: () => fileInput.click(),
      over: (e) => { e.preventDefault(); drop.classList.add('is-drag'); },
      leave: () => drop.classList.remove('is-drag'),
      drop: (e) => {
        e.preventDefault();
        drop.classList.remove('is-drag');
        if (e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
      },
      change: () => { if (fileInput.files[0]) onUpload(fileInput.files[0]); },
    };
    drop.addEventListener('click', dropHandlers.click);
    drop.addEventListener('dragover', dropHandlers.over);
    drop.addEventListener('dragleave', dropHandlers.leave);
    drop.addEventListener('drop', dropHandlers.drop);
    fileInput.addEventListener('change', dropHandlers.change);
  }
}

export function destroy() {
  if (drop && dropHandlers) {
    drop.removeEventListener('click', dropHandlers.click);
    drop.removeEventListener('dragover', dropHandlers.over);
    drop.removeEventListener('dragleave', dropHandlers.leave);
    drop.removeEventListener('drop', dropHandlers.drop);
  }
  if (fileInput && dropHandlers) {
    fileInput.removeEventListener('change', dropHandlers.change);
  }
  drop = null;
  fileInput = null;
  dropHandlers = null;
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
    const empty = emptyState({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12l8.73-5.04M12 22V12"/></svg>',
      title: 'No mods installed yet',
      message: 'Upload a .mcaddon / .mcpack file above, or browse the marketplace to find add-ons.',
      secondaryCta: { label: 'Browse the marketplace', href: 'marketplace.html' },
    });
    grid.innerHTML = empty.html;
    empty.bind();
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
    if (err.data && err.data.kind === 'manifest_missing') {
      // Backend couldn't find a manifest.json even after unwrapping inner
      // archives. The file is probably a non-standard bundle (some MCPEDL
      // packs ship as folder-zips that don't follow the .mcaddon spec).
      toast(`Couldn't find a manifest.json in ${file.name}. The file may be in a non-standard format.`, 'error');
    } else {
      toast(err.message, 'error');
    }
  }
}
