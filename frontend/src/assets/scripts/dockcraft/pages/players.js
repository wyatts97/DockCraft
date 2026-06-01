/**
 * players.js — online players, allowlist, and per-player permissions.
 *
 * Adding a player is gamertag-first: we look up the XUID behind the scenes so
 * the user never types one. Removing requires confirmation.
 *
 * Permission levels (Operator / Member / Visitor) are stored in
 * permissions.json. Operators get admin commands; Members are normal players;
 * Visitors are read-only. The Bedrock default is "member" — a player with no
 * entry in permissions.json gets that level. Removing a permission override
 * reverts them to the default.
 */

import { apiFetch, toast, withButtonSpinner } from '../api';
import { escapeHtml, emptyState } from '../utils';
import { confirmModal } from '../modal';
import { getSocket } from '../socket';

let joinHandler = null;
let leaveHandler = null;
let snapshotHandler = null;
let permissionByXuid = new Map();

export async function init() {
  await Promise.all([loadOnline(), loadAllowlist(), loadPermissions(), loadBans()]);

  const socket = getSocket();
  joinHandler = loadOnline;
  leaveHandler = loadOnline;
  snapshotHandler = (d) => renderOnline(d.players);
  socket.on('player:join', joinHandler);
  socket.on('player:leave', leaveHandler);
  socket.on('players:snapshot', snapshotHandler);

  document.getElementById('addPlayerForm')?.addEventListener('submit', onAddPlayer);
  document.getElementById('addPermissionForm')?.addEventListener('submit', onAddPermission);
  document.getElementById('addBanForm')?.addEventListener('submit', onAddBan);
}

export function destroy() {
  const socket = getSocket();
  if (joinHandler) socket.off('player:join', joinHandler);
  if (leaveHandler) socket.off('player:leave', leaveHandler);
  if (snapshotHandler) socket.off('players:snapshot', snapshotHandler);
  joinHandler = leaveHandler = snapshotHandler = null;
  permissionByXuid = new Map();
}

/* ---------------- Online ---------------- */

async function loadOnline() {
  try {
    const data = await apiFetch('/players/online');
    renderOnline(data.players);
  } catch { /* handled by status badge elsewhere */ }
}

function renderOnline(players) {
  const tbody = document.getElementById('onlineBody');
  const count = document.getElementById('onlineCount');
  if (count) count.textContent = String(players.length);
  if (!tbody) return;
  if (!players.length) {
    const empty = emptyState({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>',
      title: 'No players online right now.',
      message: 'Share your server address with friends. The IP is shown on the Dashboard.',
    });
    tbody.innerHTML = `<tr><td colspan="3">${empty.html}</td></tr>`;
    return;
  }
  tbody.innerHTML = players.map((p) => {
    const since = p.joinedAt ? new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const role = permissionByXuid.get(String(p.xuid)) || 'member';
    return `<tr>
      <td class="cell-name">${escapeHtml(p.name)}</td>
      <td>${roleBadge(role)}</td>
      <td class="cell-date">${since}</td>
    </tr>`;
  }).join('');
}

/* ---------------- Allowlist ---------------- */

async function loadAllowlist() {
  const tbody = document.getElementById('allowlistBody');
  if (!tbody) return;
  try {
    const data = await apiFetch('/players/allowlist');
    renderAllowlist(data.allowlist);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="2" class="dc-empty-cell">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAllowlist(list) {
  const tbody = document.getElementById('allowlistBody');
  if (!tbody) return;
  if (!list.length) {
    const empty = emptyState({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6M19 8v6"/></svg>',
      title: 'No players on the allowlist.',
      message: 'Allowlist is off by default. Turn it on in Settings → Players to require allowlist to join.',
    });
    tbody.innerHTML = `<tr><td colspan="2">${empty.html}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((p) => `
    <tr>
      <td class="cell-name">${escapeHtml(p.name)}</td>
      <td class="dc-row-actions">
        <button class="btn btn--ghost btn--sm" data-remove="${escapeHtml(p.xuid)}" data-name="${escapeHtml(p.name)}">Remove</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => onRemove(btn.getAttribute('data-remove'), btn.getAttribute('data-name')));
  });
}

async function onAddPlayer(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const gamertag = form.gamertag.value.trim();
  if (!gamertag) return;
  const btn = form.querySelector('[type="submit"]');
  const restore = withButtonSpinner(btn, 'Looking up…');
  try {
    const profile = await apiFetch(`/players/xuid/${encodeURIComponent(gamertag)}`);
    await apiFetch('/players/allowlist', { method: 'POST', body: { name: profile.name, xuid: profile.xuid } });
    toast(`${profile.name} added to the allowlist.`, 'success');
    form.gamertag.value = '';
    await loadAllowlist();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

async function onRemove(xuid, name) {
  const confirmed = await confirmModal({
    title: `Remove ${name}?`,
    message: 'They will no longer be able to join if the allowlist is enabled.',
    confirmText: 'Remove',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/players/allowlist/${encodeURIComponent(xuid)}`, { method: 'DELETE' });
    toast(`${name} removed.`, 'success');
    await loadAllowlist();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- Permissions ---------------- */

const ROLES = ['operator', 'member', 'visitor'];

async function loadPermissions() {
  const tbody = document.getElementById('permissionsBody');
  if (!tbody) return;
  try {
    const data = await apiFetch('/players/permissions');
    permissionByXuid = new Map(data.permissions.map((p) => [String(p.xuid), p.permission]));
    renderPermissions(data.permissions);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="dc-empty-cell">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderPermissions(perms) {
  const tbody = document.getElementById('permissionsBody');
  if (!tbody) return;
  if (!perms.length) {
    const empty = emptyState({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21c0-3 2-6 7-6s7 3 7 6"/><path d="M19 6l-2 2-1-1M16 9l-2 2-1-1"/></svg>',
      title: 'No permission overrides yet',
      message: 'Everyone uses the server default. Add a gamertag above to set a custom role.',
    });
    tbody.innerHTML = `<tr><td colspan="3">${empty.html}</td></tr>`;
    return;
  }
  tbody.innerHTML = perms.map((p) => `
    <tr>
      <td class="cell-name">${escapeHtml(p.xuid)}</td>
      <td>
        <label class="dc-perm-select">
          <span class="dc-perm-select-sr">Permission level for ${escapeHtml(p.xuid)}</span>
          <select data-perm-xuid="${escapeHtml(p.xuid)}" class="input dc-perm-select-input">
            ${ROLES.map((r) => `<option value="${r}" ${r === p.permission ? 'selected' : ''}>${capitalize(r)}</option>`).join('')}
          </select>
        </label>
      </td>
      <td class="dc-row-actions">
        <button class="btn btn--ghost btn--sm" data-remove-perm="${escapeHtml(p.xuid)}">Remove</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-perm-xuid]').forEach((sel) =>
    sel.addEventListener('change', () => onChangeRole(sel.getAttribute('data-perm-xuid'), sel.value)));
  tbody.querySelectorAll('[data-remove-perm]').forEach((btn) =>
    btn.addEventListener('click', () => onRemovePermission(btn.getAttribute('data-remove-perm'))));
}

async function onAddPermission(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const gamertag = form.gamertag.value.trim();
  const role = form.role.value;
  if (!gamertag) return;
  const btn = form.querySelector('[type="submit"]');
  const restore = withButtonSpinner(btn, 'Looking up…');
  try {
    const profile = await apiFetch(`/players/xuid/${encodeURIComponent(gamertag)}`);
    await apiFetch('/players/permissions', { method: 'PUT', body: { xuid: profile.xuid, permission: role } });
    toast(`${profile.name} is now a ${role}.`, 'success');
    form.gamertag.value = '';
    await loadPermissions();
    await loadOnline();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

async function onChangeRole(xuid, role) {
  try {
    await apiFetch('/players/permissions', { method: 'PUT', body: { xuid, permission: role } });
    permissionByXuid.set(String(xuid), role);
    toast(`Permission updated to ${role}.`, 'success');
    await loadPermissions();
    await loadOnline();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onRemovePermission(xuid) {
  const confirmed = await confirmModal({
    title: 'Remove permission override?',
    message: 'This player will revert to the server default. Their allowlist entry is not affected.',
    confirmText: 'Remove',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/players/permissions/${encodeURIComponent(xuid)}`, { method: 'DELETE' });
    permissionByXuid.delete(String(xuid));
    toast('Permission removed. Player reverted to default.', 'success');
    await loadPermissions();
    await loadOnline();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- Ban list ----------------
 * Bedrock's banned-players.json is a flat array of { name, xuid, reason? }.
 * Adding here will block that XUID from joining — the Bedrock server reads
 * this file on every connection attempt.
 */

async function loadBans() {
  const tbody = document.getElementById('bansBody');
  if (!tbody) return;
  try {
    const data = await apiFetch('/players/bans');
    renderBans(data.bans);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="dc-empty-cell">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderBans(list) {
  const tbody = document.getElementById('bansBody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="dc-empty-cell">No players banned. Add a gamertag above to block them from joining.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((p) => `
    <tr>
      <td class="cell-name">${escapeHtml(p.name)}</td>
      <td class="cell-date">${escapeHtml(p.reason || '—')}</td>
      <td class="dc-row-actions">
        <button class="btn btn--ghost btn--sm" data-unban="${escapeHtml(p.xuid)}" data-name="${escapeHtml(p.name)}">Unban</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-unban]').forEach((btn) =>
    btn.addEventListener('click', () => onUnban(btn.getAttribute('data-unban'), btn.getAttribute('data-name'))));
}

async function onAddBan(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const gamertag = form.gamertag.value.trim();
  if (!gamertag) return;
  const btn = form.querySelector('[type="submit"]');
  const restore = withButtonSpinner(btn, 'Banning…');
  try {
    const profile = await apiFetch(`/players/xuid/${encodeURIComponent(gamertag)}`);
    await apiFetch('/players/bans', { method: 'POST', body: { name: profile.name, xuid: profile.xuid } });
    toast(`${profile.name} has been banned.`, 'success');
    form.gamertag.value = '';
    await loadBans();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

async function onUnban(xuid, name) {
  const confirmed = await confirmModal({
    title: `Unban ${name}?`,
    message: 'They will be able to join the server again.',
    confirmText: 'Unban',
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/players/bans/${encodeURIComponent(xuid)}`, { method: 'DELETE' });
    toast(`${name} has been unbanned.`, 'success');
    await loadBans();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- Role badge ---------------- */

function roleBadge(role) {
  const meta = {
    operator: { icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" fill="currentColor" opacity="0.15"/><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', cls: 'dc-role--op', label: 'Operator' },
    member:   { icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.15"/><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', cls: 'dc-role--member', label: 'Member' },
    visitor:  { icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.15"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 12h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>', cls: 'dc-role--visitor', label: 'Visitor' },
  }[role] || { icon: '', cls: 'dc-role--member', label: capitalize(role) };

  return `<span class="dc-role ${meta.cls}" title="${meta.label}">${meta.icon}<span>${meta.label}</span></span>`;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
