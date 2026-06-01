/**
 * dashboard.js — server status, quick actions, live event feed.
 *
 * Stat cards: status, players online, CPU, memory, uptime. Quick actions
 * (start/stop/restart) use confirm modals for destructive ops. Live updates
 * come from Socket.io (server:stats, console:line, player:*), backed by a 10s
 * status poll as a safety net.
 */

import { apiFetch, toast, withButtonSpinner } from '../api';
import { escapeHtml, formatUptime } from '../utils';
import { confirmModal } from '../modal';
import { getSocket } from '../socket';

let statusInterval = null;
let clearBtn = null;

function onServerStats(s) { applyStats(s); }
function onConsoleLine(line) { maybePushEvent(line); }
function onPlayerJoin(p) { pushEvent(`${p.name} joined the game`, 'join'); }
function onPlayerLeave(p) { pushEvent(`${p.name} left the game`, 'leave'); }
function onServerReady(p) { pushEvent(`Server ready${p.version ? ` (v${p.version})` : ''}`, 'info'); }

export async function init() {
  bindActions();
  bindClear();
  bindGlossaryTips();
  await refreshStatus();
  await loadSparklineHistory();
  statusInterval = setInterval(refreshStatus, 10000);

  const socket = getSocket();
  socket.on('server:stats', onServerStats);
  socket.on('console:line', onConsoleLine);
  socket.on('player:join', onPlayerJoin);
  socket.on('player:leave', onPlayerLeave);
  socket.on('server:ready', onServerReady);
}

export function destroy() {
  if (statusInterval) { clearInterval(statusInterval); statusInterval = null; }
  if (clearBtn) { clearBtn.removeEventListener('click', clearEvents); clearBtn = null; }
  const socket = getSocket();
  socket.off('server:stats', onServerStats);
  socket.off('console:line', onConsoleLine);
  socket.off('player:join', onPlayerJoin);
  socket.off('player:leave', onPlayerLeave);
  socket.off('server:ready', onServerReady);
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
  pushSpark(s);
}

function clearStatValues() {
  setText('statCpu', '—');
  setText('statMem', '—');
  setText('statUptime', '—');
  setText('statPlayers', '0');
}

function renderStatusBadge(running, state) {
  const badge = document.getElementById('statStatus');
  if (!badge) return;
  let label = 'Stopped';
  let icon = 'pause';
  let cls = 'dc-status dc-status--stopped';
  if (state === 'absent') { label = 'Not created'; icon = 'minus'; cls = 'dc-status dc-status--absent'; }
  else if (state === 'unreachable') { label = 'Docker offline'; icon = 'off'; cls = 'dc-status dc-status--absent'; }
  else if (running) { label = 'Running'; icon = 'play'; cls = 'dc-status dc-status--running'; }
  badge.className = cls;
  badge.dataset.state = state || (running ? 'running' : 'stopped');
  badge.innerHTML = `<span class="dc-status-icon" aria-hidden="true">${STATUS_ICONS[icon]}</span><span>${escapeHtml(label)}</span>`;
}

const STATUS_ICONS = {
  play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="11" width="14" height="2" rx="1"/></svg>',
  off:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/></svg>',
};

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
    clearStatValues();
  }
}

/* ---- Sparklines ---- */
const SPARK_MAX_POINTS = 60;
const sparkBuffers = { cpu: [], memory: [], players: [] };

function pushSpark(s) {
  sparkBuffers.cpu.push(s.cpu ?? 0);
  sparkBuffers.memory.push(s.memory ?? 0);
  sparkBuffers.players.push(s.playerCount ?? 0);
  for (const k of Object.keys(sparkBuffers)) {
    if (sparkBuffers[k].length > SPARK_MAX_POINTS) sparkBuffers[k].shift();
  }
  renderSparks();
}

function renderSparks() {
  for (const key of ['cpu', 'memory', 'players']) {
    const svg = document.querySelector(`[data-spark="${key}"]`);
    if (!svg) continue;
    svg.innerHTML = sparkPath(sparkBuffers[key], key === 'players' ? null : 100);
  }
}

function sparkPath(values, maxValue) {
  if (!values.length) return '';
  const W = 100, H = 28, PAD = 1;
  const max = maxValue != null ? maxValue : Math.max(1, ...values);
  const stepX = (W - PAD * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - (Math.max(0, Math.min(max, v)) / max) * (H - PAD * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  // Single polyline so it stays crisp at any size.
  return `<polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>`;
}

async function loadSparklineHistory() {
  try {
    const data = await apiFetch('/server/stats/history');
    const pts = data.points || [];
    // Seed the buffers with the server's last readings so the chart isn't empty
    // for the first 5 minutes after page load.
    for (const p of pts) {
      sparkBuffers.cpu.push(p.cpu ?? 0);
      sparkBuffers.memory.push(p.memory ?? 0);
      sparkBuffers.players.push(p.playerCount ?? 0);
    }
    for (const k of Object.keys(sparkBuffers)) {
      while (sparkBuffers[k].length > SPARK_MAX_POINTS) sparkBuffers[k].shift();
    }
    renderSparks();
  } catch { /* sparklines are progressive enhancement */ }
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

function bindClear() {
  clearBtn = document.getElementById('eventFeedClear');
  if (clearBtn) clearBtn.addEventListener('click', clearEvents);
}

function bindGlossaryTips() {
  // Each stat card has a tiny "?" button that opens a plain-English description
  // of the metric. The data-tip attribute carries the message so the same
  // pattern works in settings.js without re-implementation.
  document.querySelectorAll('.dc-stat .dc-tip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });
    btn.addEventListener('blur', () => btn.setAttribute('aria-expanded', 'false'));
  });
}

function clearEvents() {
  const feed = document.getElementById('eventFeed');
  if (!feed) return;
  feed.innerHTML = '<div class="dc-empty-cell" data-empty>Waiting for server activity…</div>';
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
  item.innerHTML = `<span class="dc-event-dot" aria-hidden="true"></span><span class="dc-event-text">${escapeHtml(text)}</span><span class="dc-event-time">${escapeHtml(time)}</span>`;
  feed.prepend(item);
  while (feed.children.length > MAX_EVENTS) feed.lastChild.remove();
}
