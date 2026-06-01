/**
 * console.js — live, color-coded server console with filtering and bulk export.
 *
 * Loads the recent backlog from the API, then streams new lines over
 * Socket.io (console:line). Commands are sent via POST /api/console/command.
 *
 * Toolbar features:
 *  - Filter chips: scope visible lines by level (info/warn/error/join/leave/cmd)
 *  - Autoscroll toggle: pause when you scroll up to read history
 *  - Copy: copies the currently visible (filtered) lines to the clipboard
 *  - Download: downloads the full in-memory buffer as a timestamped .log file
 *  - Clear: empties the on-screen buffer (and resets counts)
 */

import { apiFetch, toast } from '../api';
import { escapeHtml, emptyState } from '../utils';
import { getSocket } from '../socket';

const MAX_LINES = 2000;

let consoleHandler = null;
let lines = []; // in-memory ring of { text, level, t }
let activeFilter = 'all';
let autoscroll = true;
let output = null;
let counts = { all: 0, info: 0, warn: 0, error: 0, join: 0, leave: 0, cmd: 0 };

export async function init() {
  output = document.getElementById('consoleOutput');
  const form = document.getElementById('consoleForm');
  const input = document.getElementById('consoleInput');
  const clearBtn = document.getElementById('consoleClear');
  const copyBtn = document.getElementById('consoleCopy');
  const downloadBtn = document.getElementById('consoleDownload');
  const autoscrollCb = document.getElementById('consoleAutoscroll');
  if (!output) return;

  output.addEventListener('scroll', () => {
    // If the user is within ~40px of the bottom, keep autoscroll on; otherwise
    // they're reading history and we should leave them there.
    autoscroll = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
    if (autoscrollCb) autoscrollCb.checked = autoscroll;
  });

  autoscrollCb?.addEventListener('change', () => { autoscroll = autoscrollCb.checked; });

  bindFilters();

  // Initial backlog.
  try {
    const data = await apiFetch('/console/logs?tail=200');
    data.lines.forEach((l) => recordLine(l, classify(l)));
    render();
  } catch (err) {
    recordLine(`[DockCraft] Could not load logs: ${err.message}`, 'error');
    render();
  }

  // Live stream.
  const socket = getSocket();
  consoleHandler = (line) => {
    recordLine(line.text, line.level || classify(line.text));
    render();
  };
  socket.on('console:line', consoleHandler);

  clearBtn?.addEventListener('click', () => {
    lines = [];
    counts = { all: 0, info: 0, warn: 0, error: 0, join: 0, leave: 0, cmd: 0 };
    if (output) output.innerHTML = '';
    renderCounts();
  });

  copyBtn?.addEventListener('click', async () => {
    const text = visibleLines().map((l) => `[${l.t}] ${l.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${visibleLines().length} line(s).`, 'success');
    } catch {
      toast('Could not copy — clipboard permission denied.', 'error');
    }
  });

  downloadBtn?.addEventListener('click', () => {
    const blob = new Blob([lines.map((l) => `[${l.t}] ${l.text}`).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `dockcraft-${stamp}.log`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const command = input.value.trim();
    if (!command) return;
    recordLine(`> ${command}`, 'cmd');
    render();
    input.value = '';
    try {
      await apiFetch('/console/command', { method: 'POST', body: { command } });
    } catch (err) {
      recordLine(`[DockCraft] ${err.message}`, 'error');
      render();
      toast(err.message, 'error');
    }
  });
}

export function destroy() {
  const socket = getSocket();
  if (consoleHandler) socket.off('console:line', consoleHandler);
  consoleHandler = null;
  lines = [];
  counts = { all: 0, info: 0, warn: 0, error: 0, join: 0, leave: 0, cmd: 0 };
  activeFilter = 'all';
  autoscroll = true;
  output = null;
}

function recordLine(text, level) {
  lines.push({ text, level, t: new Date().toISOString() });
  if (lines.length > MAX_LINES) lines.shift();
  counts.all += 1;
  if (counts[level] !== undefined) counts[level] += 1;
}

function visibleLines() {
  return activeFilter === 'all' ? lines : lines.filter((l) => l.level === activeFilter);
}

function render() {
  if (!output) return;
  const vis = visibleLines();
  if (!vis.length) {
    const empty = emptyState({
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H4z"/><path d="M4 20h16M8 16l-1 4M16 16l1 4"/></svg>',
      title: lines.length ? 'No log lines match this filter.' : 'No console output yet.',
      message: lines.length
        ? 'Try another filter chip, or clear the filter to see all lines.'
        : 'Start the server to begin streaming logs here.',
      primaryCta: lines.length ? { label: 'Clear filter', onClick: resetFilter } : null,
    });
    output.innerHTML = empty.html;
    empty.bind();
  } else {
    output.innerHTML = vis.map((l) => {
      const time = l.t ? l.t.slice(11, 19) : '';
      return `<div class="dc-log-line dc-log--${l.level}"><span class="dc-log-time">${time}</span><span class="dc-log-text">${escapeHtml(l.text)}</span></div>`;
    }).join('');
  }
  renderCounts();
  if (autoscroll && vis.length) output.scrollTop = output.scrollHeight;
}

function resetFilter() {
  activeFilter = 'all';
  document.querySelectorAll('[data-filter]').forEach((b) => {
    const on = b.getAttribute('data-filter') === 'all';
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  render();
}

function renderCounts() {
  document.querySelectorAll('[data-filter-count]').forEach((el) => {
    const k = el.getAttribute('data-filter-count');
    el.textContent = counts[k] || 0;
  });
}

function bindFilters() {
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  });
}

function classify(text) {
  if (/\[ERROR\]|\bERROR\b/.test(text)) return 'error';
  if (/\[WARNING\]|\bWARN/.test(text)) return 'warn';
  if (/Player connected/i.test(text)) return 'join';
  if (/Player disconnected/i.test(text)) return 'leave';
  return 'info';
}
