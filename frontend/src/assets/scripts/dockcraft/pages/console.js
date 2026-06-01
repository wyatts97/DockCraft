/**
 * console.js — live, color-coded server console with a command input.
 *
 * Loads the recent backlog from the API, then streams new lines over
 * Socket.io (console:line). Commands are sent via POST /api/console/command.
 */

import { apiFetch, toast, escapeHtml } from '../api';
import { getSocket } from '../socket';

const MAX_LINES = 1000;

let consoleHandler = null;

export async function init() {
  const output = document.getElementById('consoleOutput');
  const form = document.getElementById('consoleForm');
  const input = document.getElementById('consoleInput');
  const clearBtn = document.getElementById('consoleClear');
  if (!output) return;

  let autoscroll = true;
  output.addEventListener('scroll', () => {
    autoscroll = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
  });

  const append = (text, level = 'info') => {
    const line = document.createElement('div');
    line.className = `dc-log-line dc-log--${level}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    line.innerHTML = `<span class="dc-log-time">${time}</span><span class="dc-log-text">${escapeHtml(text)}</span>`;
    output.appendChild(line);
    while (output.children.length > MAX_LINES) output.firstChild.remove();
    if (autoscroll) output.scrollTop = output.scrollHeight;
  };

  // Initial backlog.
  try {
    const data = await apiFetch('/console/logs?tail=200');
    data.lines.forEach((l) => append(l, classify(l)));
  } catch (err) {
    append(`[DockCraft] Could not load logs: ${err.message}`, 'error');
  }

  // Live stream.
  const socket = getSocket();
  consoleHandler = (line) => append(line.text, line.level || classify(line.text));
  socket.on('console:line', consoleHandler);

  clearBtn?.addEventListener('click', () => { output.innerHTML = ''; });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const command = input.value.trim();
    if (!command) return;
    append(`> ${command}`, 'cmd');
    input.value = '';
    try {
      await apiFetch('/console/command', { method: 'POST', body: { command } });
    } catch (err) {
      append(`[DockCraft] ${err.message}`, 'error');
      toast(err.message, 'error');
    }
  });
}

export function destroy() {
  const socket = getSocket();
  if (consoleHandler) socket.off('console:line', consoleHandler);
  consoleHandler = null;
}

function classify(text) {
  if (/\[ERROR\]|\bERROR\b/.test(text)) return 'error';
  if (/\[WARNING\]|\bWARN/.test(text)) return 'warn';
  if (/Player connected/i.test(text)) return 'join';
  if (/Player disconnected/i.test(text)) return 'leave';
  return 'info';
}
