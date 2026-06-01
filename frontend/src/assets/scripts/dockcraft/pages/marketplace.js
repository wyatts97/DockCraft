/**
 * marketplace.js — CurseForge add-on browser with search, dynamic category
 * chips, on-demand refresh, and best-effort one-click install.
 *
 * Data comes from /api/marketplace (a cached cfwidget scrape). Install streams
 * the pack straight from forgecdn; if that isn't possible the API returns a
 * `fallback` and we open the CurseForge page so the user can grab it manually.
 *
 * Card layout: thumbnail is a self-contained 16:9 block at the top of the
 * card, body is a separate card-styled block underneath (theme bg). All
 * detail info — full description, tags, install — lives inline on the card
 * so the user never has to open a modal to read about a pack.
 */

import { apiFetch, toast } from '../api';
import { escapeHtml, formatSize, emptyState } from '../utils';

let allPacks = [];
let activeCategory = 'all';
let query = '';

export async function init() {
  await load();

  const search = document.getElementById('mktSearch');
  search?.addEventListener('input', () => { query = search.value.toLowerCase().trim(); render(); });
  document.getElementById('mktClearFilters')?.addEventListener('click', clearMarketplaceFilters);

  document.getElementById('mktRefresh')?.addEventListener('click', onRefresh);
}

export function destroy() {
  allPacks = [];
  activeCategory = 'all';
  query = '';
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
  allPacks.forEach((p) => packCategories(p).forEach((c) => cats.add(c)));
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
  if (p.tags && p.tags.length) return p.tags;
  if (p.categories && p.categories.length) return p.categories;
  if (p.category) return [p.category];
  return ['addons'];
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
    const hasQuery = !!query || activeCategory !== 'all';
    const empty = emptyState({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
      title: hasQuery ? 'No packs match your search.' : 'Marketplace is empty.',
      message: hasQuery
        ? 'Try a different category or clear the search to see all packs.'
        : 'The curated pack registry is empty for now. Check back later, or upload a .mcaddon on the Mods page.',
      primaryCta: hasQuery ? { label: 'Clear filters', onClick: clearMarketplaceFilters } : null,
    });
    grid.innerHTML = empty.html;
    empty.bind();
    return;
  }
  grid.innerHTML = packs.map(renderCard).join('');

  grid.querySelectorAll('[data-install]').forEach((btn) =>
    btn.addEventListener('click', () => onInstall(btn.getAttribute('data-install'), btn)));
}

function renderCard(p) {
  const cat = p.category || packCategories(p)[0] || 'addon';
  const tags = packCategories(p);
  const versionBit = p.version ? ` · ${escapeHtml(p.version)}` : '';
  const sizeBit = p.fileSize ? ` · ${formatSize(p.fileSize)}` : '';
  const meta = `by ${escapeHtml(p.author || 'Unknown')}${versionBit}${sizeBit}`;
  const summary = p.summary || p.description || 'No description available.';
  // Convert plain-text line breaks into <br>; third-party content, never HTML.
  const summaryHtml = escapeHtml(summary).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
  const hasMore = (p.description || '').length > (p.summary || '').length + 8;
  const init = escapeHtml(initials(p.name));
  const fallbackImg = p.thumbnail
    ? `<img src="${escapeHtml(p.thumbnail)}" alt="" loading="lazy" data-initials="${init}" onerror="this.parentNode.classList.add('dc-mkt-thumb--fallback');this.replace(document.createTextNode(this.dataset.initials));">`
    : `<span class="dc-mkt-thumb-init">${init}</span>`;
  return `
    <article class="dc-mkt-card">
      <div class="dc-mkt-thumb" aria-hidden="true">
        ${fallbackImg}
        <span class="dc-mkt-badge">${escapeHtml(cat)}</span>
      </div>
      <div class="dc-mkt-body">
        <h3 class="dc-mkt-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
        <div class="dc-mkt-meta">${meta}</div>
        <p class="dc-mkt-summary">${summaryHtml}</p>
        ${hasMore ? `<details class="dc-mkt-more"><summary>Read more</summary><div class="dc-mkt-desc">${escapeHtml(p.description).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</div></details>` : ''}
        <div class="dc-mkt-tags">${tags.slice(0, 3).map((t) => `<span class="dc-pill">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="dc-mkt-actions">
          <a class="btn btn--ghost btn--sm" href="${escapeHtml(p.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">View</a>
          <button class="btn btn--primary btn--sm dc-mkt-install" data-install="${escapeHtml(p.id)}">Install</button>
        </div>
      </div>
    </article>`;
}

function initials(name) {
  return String(name).split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();
}

function clearMarketplaceFilters() {
  const search = document.getElementById('mktSearch');
  if (search) search.value = '';
  query = '';
  activeCategory = 'all';
  document.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('is-active', c.getAttribute('data-cat') === 'all'));
  render();
}

async function onInstall(id, btn) {
  const original = btn.innerHTML;
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
    const fb = err.data && err.data.fallback;
    if (fb) {
      window.open(err.data.sourceUrl || err.data.fileUrl, '_blank', 'noopener');
      toast('Opening CurseForge — download the file, then install it via Mods → Upload.', 'info');
    } else if (err.data && err.data.kind === 'manifest_missing') {
      // Packs whose archive shape DockCraft can't unwrap (rare, but real
      // for some MCPEDL bundles) — point the user at the manual path.
      btn.disabled = false;
      btn.innerHTML = original;
      toastHTML(
        'This pack’s archive is in a format DockCraft can’t auto-install.',
        'error',
        'Try uploading it manually from the Mods page.',
        { label: 'Open Mods', href: 'mods.html' }
      );
      return;
    } else {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/**
 * Like toast(), but with a secondary action link (used for the
 * "this pack can't be auto-installed" hint so the user has a one-click
 * path to the Mods upload page).
 */
function toastHTML(message, type, secondaryLabel, action) {
  toast(message, type);
  if (!action) return;
  // Append an action link into the most recent toast element.
  const host = document.querySelector('.dc-toast-host');
  if (!host) return;
  const last = host.querySelector('.dc-toast:last-child');
  if (!last) return;
  const link = document.createElement(action.href ? 'a' : 'button');
  link.className = 'dc-toast-action';
  if (action.href) link.setAttribute('href', action.href);
  link.textContent = `${action.label} →`;
  last.appendChild(link);
}
