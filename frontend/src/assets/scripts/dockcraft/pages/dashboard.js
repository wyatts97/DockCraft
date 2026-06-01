/**
 * dashboard.js — server status, quick actions, live event feed.
 *
 * Stat cards: status, players online, CPU, memory, uptime. Quick actions
 * (start/stop/restart) use confirm modals for destructive ops. Live updates
 * come from Socket.io (server:stats, console:line, player:*), backed by a 10s
 * status poll as a safety net.
 */

import { apiFetch, toast, formatUptime, escapeHtml, withButtonSpinner } from '../api';
import { confirmModal } from '../modal';
import { getSocket } from '../socket';

export async function init() {
  bindActions();
  await refreshStatus();
  setInterval(refreshStatus, 10000);

  const socket = getSocket();
  socket.on('server:stats', (s) => applyStats(s));
  socket.on('console:line', (line) => maybePushEvent(line));
  socket.on('player:join', (p) => pushEvent(`${p.name} joined the game`, 'join'));
  socket.on('player:leave', (p) => pushEvent(`${p.name} left the game`, 'leave'));
  socket.on('server:ready', (p) => pushEvent(`Server ready${p.version ? ` (v${p.version})` : ''}`, 'info'));
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function applyStats(s) {
  setText('statCpu', `${s.cpu ?? 0}%`);
  setText('statMem', `${s.memory ?? 0}%`);
  setText('statUptime', s.running ? formatUptime(s.uptimeSeconds) : '—');
  setText('statPlayers', String(s.playerCount ?? 0));
  renderStatusBadge(s.running, s.state);
  toggleActionButtons(s.running);
}

function renderStatusBadge(running, state) {
  const badge = document.getElementById('statStatus');
  if (!badge) return;
  let label = 'Stopped';
  let cls = 'dc-status dc-status--stopped';
  if (state === 'absent') { label = 'Not created'; cls = 'dc-status dc-status--absent'; }
  else if (state === 'unreachable') { label = 'Docker offline'; cls = 'dc-status dc-status--absent'; }
  else if (running) { label = 'Running'; cls = 'dc-status dc-status--running'; }
  badge.className = cls;
  badge.textContent = label;
}

function toggleActionButtons(running) {
  const start = document.querySelector('[data-action="start"]');
  const stop = document.querySelector('[data-action="stop"]');
  const restart = document.querySelector('[data-action="restart"]');
  if (start) start.disabled = running;
  if (stop) stop.disabled = !running;
  if (restart) restart.disabled = !running;
}

async function refreshStatus() {
  try {
    const s = await apiFetch('/server/status');
    applyStats(s);
  } catch {
    renderStatusBadge(false, 'absent');
  }
}

function bindActions() {
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const meta = {
        start: { path: '/server/start', label: 'Starting…', confirm: null, msg: 'Server is starting…' },
        stop: { path: '/server/stop', label: 'Stopping…', confirm: { title: 'Stop the server?', message: 'All players will be disconnected.', danger: true, confirmText: 'Stop server' }, msg: 'Server is stopping…' },
        restart: { path: '/server/restart', label: 'Restarting…', confirm: { title: 'Restart the server?', message: 'Players will be briefly disconnected while the server restarts.', confirmText: 'Restart' }, msg: 'Server is restarting…' },
      }[action];
      if (!meta) return;
      if (meta.confirm && !(await confirmModal(meta.confirm))) return;

      const restore = withButtonSpinner(btn, meta.label);
      try {
        await apiFetch(meta.path, { method: 'POST' });
        toast(meta.msg, 'success');
        setTimeout(refreshStatus, 1200);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        restore();
      }
    });
  });
}

const MAX_EVENTS = 30;
function maybePushEvent(line) {
  if (!line || !line.text) return;
  if (['join', 'leave', 'error', 'warn'].includes(line.level)) {
    pushEvent(line.text, line.level);
  }
}

function pushEvent(text, level = 'info') {
  const feed = document.getElementById('eventFeed');
  if (!feed) return;
  const empty = feed.querySelector('[data-empty]');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = `dc-event dc-event--${level}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  item.innerHTML = `<span class="dc-event-dot"></span><span class="dc-event-text">${escapeHtml(text)}</span><span class="dc-event-time">${time}</span>`;
  feed.prepend(item);
  while (feed.children.length > MAX_EVENTS) feed.lastChild.remove();
}
