/**
 * utils.js — small DOM/string helpers shared across DockCraft pages.
 *
 * Consolidates what used to be duplicated copies of escapeHtml / formatSize
 * sprinkled across api.js, modal.js, and individual page modules.
 */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for safe interpolation into innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Format a byte count as "1.2 MB" / "240 KB" / "0 B" using binary units. */
export function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return i === 0 ? `${n} ${units[i]}` : `${n.toFixed(1)} ${units[i]}`;
}

/** Format a server uptime duration (seconds) as "2d 4h 17m" / "12m" / "—". */
export function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/** Format an ISO date string as "May 31 · 12:00" (locale-independent). */
export function formatBackupName(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day} · ${hh}:${mm}`;
}

/** Format an ISO date string as a relative duration like "2 minutes ago". */
export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** Debounce a function — useful for search inputs. */
export function debounce(fn, ms = 200) {
  let t;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ---------- Empty state -------------------------------------------------- */
/* Onboarding CTA card used in tables, lists, and grid sections.
 * `primaryCta` can be a string (label) or { label, onClick }.
 * `secondaryCta` is a link-style action (e.g. "Browse the marketplace").
 */
export function emptyState({ icon, title, message, primaryCta, secondaryCta }) {
  const primaryBtn = primaryCta
    ? (typeof primaryCta === 'string'
      ? `<span class="dc-empty-cta">${escapeHtml(primaryCta)}</span>`
      : `<button class="btn btn--primary" type="button" id="dcEmptyPrimary">${escapeHtml(primaryCta.label)}</button>`)
    : '';
  const secondaryLink = secondaryCta
    ? (secondaryCta.href
      ? `<a class="dc-empty-link" href="${escapeHtml(secondaryCta.href)}">${escapeHtml(secondaryCta.label || secondaryCta.text || '')} →</a>`
      : `<button class="dc-empty-link" type="button" id="dcEmptySecondary">${escapeHtml(secondaryCta.label)} →</button>`)
    : '';
  const html = `<div class="dc-empty">
      <div class="dc-empty-icon" aria-hidden="true">${icon || ''}</div>
      <h3 class="dc-empty-title">${escapeHtml(title)}</h3>
      ${message ? `<p class="dc-empty-msg">${escapeHtml(message)}</p>` : ''}
      ${primaryBtn || secondaryLink ? `<div class="dc-empty-actions">${primaryBtn}${secondaryLink}</div>` : ''}
    </div>`;
  return {
    html,
    bind() {
      const root = document.getElementById('dcEmptyPrimary');
      if (root && primaryCta && typeof primaryCta === 'object') root.addEventListener('click', primaryCta.onClick);
      const sec = document.getElementById('dcEmptySecondary');
      if (sec && secondaryCta && typeof secondaryCta === 'object' && secondaryCta.onClick) sec.addEventListener('click', secondaryCta.onClick);
    },
  };
}
