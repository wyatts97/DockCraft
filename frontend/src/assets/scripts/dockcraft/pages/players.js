/**
 * players.js — online players + allowlist management.
 *
 * Adding a player is gamertag-first: we look up the XUID behind the scenes so
 * the user never types one. Removing requires confirmation.
 */

import { apiFetch, toast, escapeHtml, withButtonSpinner } from '../api';
import { confirmModal } from '../modal';
import { getSocket } from '../socket';

let joinHandler = null;
let leaveHandler = null;
let snapshotHandler = null;

export async function init() {
  await Promise.all([loadOnline(), loadAllowlist()]);

  const socket = getSocket();
  joinHandler = loadOnline;
  leaveHandler = loadOnline;
  snapshotHandler = (d) => renderOnline(d.players);
  socket.on('player:join', joinHandler);
  socket.on('player:leave', leaveHandler);
  socket.on('players:snapshot', snapshotHandler);

  const form = document.getElementById('addPlayerForm');
  form?.addEventListener('submit', onAddPlayer);
}

export function destroy() {
  const socket = getSocket();
  if (joinHandler) socket.off('player:join', joinHandler);
  if (leaveHandler) socket.off('player:leave', leaveHandler);
  if (snapshotHandler) socket.off('players:snapshot', snapshotHandler);
  joinHandler = leaveHandler = snapshotHandler = null;
}

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
    tbody.innerHTML = `<tr><td colspan="2" class="dc-empty-cell">No players online right now.</td></tr>`;
    return;
  }
  tbody.innerHTML = players.map((p) => {
    const since = p.joinedAt ? new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    return `<tr><td class="cell-name">${escapeHtml(p.name)}</td><td class="cell-date">${since}</td></tr>`;
  }).join('');
}

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
    tbody.innerHTML = `<tr><td colspan="2" class="dc-empty-cell">No players on the allowlist.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((p) => `
    <tr>
      <td class="cell-name">${escapeHtml(p.name)}</td>
      <td style="text-align:right">
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
