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
        <div class="dc-mkt-actions">
          <button class="btn btn--ghost btn--sm" data-detail="${escapeHtml(p.id)}">Read more</button>
          <button class="btn btn--primary dc-mkt-install" data-install="${escapeHtml(p.id)}">Install</button>
        </div>
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-install]').forEach((btn) =>
    btn.addEventListener('click', () => onInstall(btn.getAttribute('data-install'), btn)));
  grid.querySelectorAll('[data-detail]').forEach((btn) =>
    btn.addEventListener('click', () => showDetail(btn.getAttribute('data-detail'))));
}

function initials(name) {
  return String(name).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function showDetail(id) {
  const p = allPacks.find((x) => x.id === id);
  if (!p) return;

  const overlay = document.createElement('div');
  overlay.className = 'dc-modal-overlay';
  overlay.innerHTML = `
    <div class="dc-modal dc-modal--wide" role="dialog" aria-modal="true">
      <div class="dc-mkt-detail">
        <div class="dc-mkt-detail-thumb">${p.thumbnail ? `<img src="${escapeHtml(p.thumbnail)}" alt="">` : initials(p.name)}</div>
        <div class="dc-mkt-detail-body">
          <h3 class="dc-modal-title">${escapeHtml(p.name)}</h3>
          <div class="cell-date" style="margin-bottom:12px">by ${escapeHtml(p.author || 'Unknown')}${p.version ? ` · ${escapeHtml(p.version)}` : ''}${p.fileSize ? ` · ${formatSize(p.fileSize)}` : ''}</div>
          <div class="dc-mkt-detail-tags">${packCategories(p).map((c) => `<span class="tag t-info">${escapeHtml(c)}</span>`).join('')}</div>
          <div class="dc-mkt-detail-desc">${p.description || escapeHtml(p.summary || 'No description available.')}</div>
          <div class="dc-modal-actions" style="margin-top:18px">
            <button class="btn btn--ghost" data-close>Close</button>
            <a class="btn btn--ghost" href="${escapeHtml(p.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">View on CurseForge</a>
            <button class="btn btn--primary" data-install="${escapeHtml(p.id)}">Install</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-in'));

  const close = () => {
    overlay.classList.remove('is-in');
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const installBtn = overlay.querySelector('[data-install]');
  if (installBtn) {
    installBtn.addEventListener('click', () => {
      onInstall(p.id, installBtn);
      installBtn.disabled = true;
      installBtn.textContent = 'Installing…';
    });
  }
  document.addEventListener('keydown', onKey);
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
