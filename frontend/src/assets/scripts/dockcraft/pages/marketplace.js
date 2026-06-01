/**
 * marketplace.js — CurseForge add-on browser with search, dynamic category
 * chips, on-demand refresh, and best-effort one-click install.
 *
 * Data comes from /api/marketplace (a cached cfwidget scrape). Install streams
 * the pack straight from forgecdn; if that isn't possible the API returns a
 * `fallback` and we open the CurseForge page so the user can grab it manually.
 */

import { apiFetch, toast, escapeHtml } from '../api';

let allPacks = [];
let activeCategory = 'all';
let query = '';

export async function init() {
  await load();

  const search = document.getElementById('mktSearch');
  search?.addEventListener('input', () => { query = search.value.toLowerCase().trim(); render(); });

  document.getElementById('mktRefresh')?.addEventListener('click', onRefresh);
}

async function load() {
  const grid = document.getElementById('mktGrid');
  if (!grid) return;
  try {
    const data = await apiFetch('/marketplace');
    allPacks = data.packs || [];
    renderUpdated(data.updated);
    renderChips();
    render();
  } catch (err) {
    grid.innerHTML = `<div class="dc-empty-cell">${escapeHtml(err.message)}</div>`;
  }
}

async function onRefresh() {
  const btn = document.getElementById('mktRefresh');
  const grid = document.getElementById('mktGrid');
  if (!btn) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="dc-spinner"></span> Refreshing…`;
  if (grid) grid.innerHTML = `<div class="dc-empty-cell">Fetching the latest from CurseForge…</div>`;
  try {
    const data = await apiFetch('/marketplace/refresh', { method: 'POST' });
    allPacks = data.packs || [];
    renderUpdated(data.updated);
    renderChips();
    render();
    const failed = (data.errors || []).length;
    toast(failed ? `Refreshed with ${failed} source error(s).` : 'Marketplace refreshed.', failed ? 'error' : 'success');
  } catch (err) {
    toast(err.message, 'error');
    render();
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function renderUpdated(updated) {
  const el = document.getElementById('mktUpdated');
  if (el && updated) el.textContent = `Updated ${new Date(updated).toLocaleString()}.`;
}

function renderChips() {
  const row = document.getElementById('mktChips');
  if (!row) return;
  const cats = new Set();
  allPacks.forEach((p) => (p.categories || (p.category ? [p.category] : [])).forEach((c) => cats.add(c)));
  const all = ['all', ...[...cats].sort()];
  row.innerHTML = all.map((c) =>
    `<button class="dc-chip ${c === activeCategory ? 'is-active' : ''}" data-cat="${escapeHtml(c)}">${c === 'all' ? 'All' : escapeHtml(c)}</button>`).join('');
  row.querySelectorAll('[data-cat]').forEach((chip) => {
    chip.addEventListener('click', () => {
      activeCategory = chip.getAttribute('data-cat');
      row.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('is-active', c === chip));
      render();
    });
  });
}

function packCategories(p) {
  return p.categories && p.categories.length ? p.categories : (p.category ? [p.category] : []);
}

function render() {
  const grid = document.getElementById('mktGrid');
  if (!grid) return;
  const packs = allPacks.filter((p) => {
    const catOk = activeCategory === 'all' || packCategories(p).includes(activeCategory);
    const haystack = `${p.name} ${p.author} ${p.summary} ${packCategories(p).join(' ')}`.toLowerCase();
    const qOk = !query || haystack.includes(query);
    return catOk && qOk;
  });
  if (!packs.length) {
    grid.innerHTML = `<div class="dc-empty-cell">No packs match your search.</div>`;
    return;
  }
  grid.innerHTML = packs.map((p) => `
    <div class="dc-mkt-card">
      <div class="dc-mkt-thumb">${p.thumbnail ? `<img src="${escapeHtml(p.thumbnail)}" alt="" loading="lazy">` : initials(p.name)}</div>
      <div class="dc-mkt-body">
        <div class="dc-mkt-top">
          <span class="tag t-info">${escapeHtml(p.category || 'Addons')}</span>
          ${p.version ? `<span class="cell-date">${escapeHtml(p.version)}</span>` : ''}
        </div>
        <div class="dc-mod-name">${escapeHtml(p.name)}</div>
        <div class="cell-date">by ${escapeHtml(p.author || 'Unknown')}${p.fileSize ? ` · ${formatSize(p.fileSize)}` : ''}</div>
        <div class="dc-mod-desc">${escapeHtml(p.summary || '')}</div>
        <button class="btn btn--primary dc-mkt-install" data-install="${escapeHtml(p.id)}">Install</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-install]').forEach((btn) =>
    btn.addEventListener('click', () => onInstall(btn.getAttribute('data-install'), btn)));
}

function initials(name) {
  return String(name).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

async function onInstall(id, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="dc-spinner"></span> Installing…`;
  try {
    await apiFetch(`/marketplace/install/${encodeURIComponent(id)}`, { method: 'POST' });
    btn.classList.remove('btn--primary');
    btn.classList.add('btn--ghost');
    btn.textContent = 'Installed ✓';
    btn.disabled = true;
    toast('Pack installed. Restart the server to apply.', 'success');
  } catch (err) {
    // The API returns a fallback (with the CurseForge page) when it can't
    // auto-download — open it so the user can grab the file manually.
    const fb = err.data && err.data.fallback;
    if (fb) {
      window.open(err.data.sourceUrl || err.data.fileUrl, '_blank', 'noopener');
      toast('Opening CurseForge — download the file, then install it via Mods → Upload.', 'info');
    } else {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = original;
  }
}
