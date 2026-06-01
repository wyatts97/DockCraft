/**
 * settings.js — schema-driven server settings form.
 *
 * Fetches the grouped schema (/settings/schema) and current values
 * (/settings), renders tabbed, plain-English fields with tooltips, and saves
 * via PUT /settings which recreates the container ("Save & Restart").
 */

import { apiFetch, toast, escapeHtml, withButtonSpinner } from '../api';
import { confirmModal } from '../modal';

let schema = null;
let values = {};

export async function init() {
  const container = document.getElementById('settingsTabs');
  if (!container) return;
  try {
    [schema, values] = await Promise.all([
      apiFetch('/settings/schema'),
      apiFetch('/settings').then((d) => d.env),
    ]);
    renderTabs();
  } catch (err) {
    container.innerHTML = `<div class="dc-empty-cell">${escapeHtml(err.message)}</div>`;
    return;
  }

  document.getElementById('saveSettings')?.addEventListener('click', onSave);
}

function renderTabs() {
  const tabsNav = document.getElementById('settingsTabNav');
  const tabsBody = document.getElementById('settingsTabBody');
  if (!tabsNav || !tabsBody) return;

  tabsNav.innerHTML = schema.groups.map((g, i) =>
    `<button class="dc-tab ${i === 0 ? 'is-active' : ''}" data-tab="${g.id}">${escapeHtml(g.label)}${g.advanced ? ' ⚠' : ''}</button>`
  ).join('');

  tabsBody.innerHTML = schema.groups.map((g, i) => `
    <div class="dc-tab-panel ${i === 0 ? 'is-active' : ''}" data-panel="${g.id}">
      ${g.advanced ? '<div class="dc-danger-note">Advanced settings — changing these can break your server. Proceed carefully.</div>' : ''}
      <div class="dc-field-grid">${g.fields.map(renderField).join('')}</div>
    </div>`).join('');

  tabsNav.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-tab');
      tabsNav.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      tabsBody.querySelectorAll('[data-panel]').forEach((p) =>
        p.classList.toggle('is-active', p.getAttribute('data-panel') === id));
    });
  });
}

function renderField(field) {
  const current = values[field.key] ?? field.default ?? '';
  let control;
  if (field.type === 'boolean') {
    const checked = String(current) === 'true' ? 'checked' : '';
    control = `<label class="dc-switch">
        <input type="checkbox" data-key="${field.key}" data-type="boolean" ${checked}>
        <span class="dc-switch-track"></span>
      </label>`;
  } else if (field.type === 'enum') {
    control = `<select class="input" data-key="${field.key}">
        ${field.options.map((o) => `<option value="${escapeHtml(o)}" ${String(current) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      </select>`;
  } else {
    const type = field.type === 'number' ? 'number' : 'text';
    control = `<input class="input" type="${type}" data-key="${field.key}" value="${escapeHtml(String(current))}">`;
  }
  return `
    <div class="dc-field">
      <div class="dc-field-label">
        <span>${escapeHtml(field.label)}</span>
        <span class="dc-tip" title="${escapeHtml(field.description)}">?</span>
      </div>
      ${control}
    </div>`;
}

function collect() {
  const out = {};
  document.querySelectorAll('[data-key]').forEach((el) => {
    const key = el.getAttribute('data-key');
    if (el.getAttribute('data-type') === 'boolean') out[key] = el.checked ? 'true' : 'false';
    else out[key] = el.value;
  });
  return out;
}

async function onSave() {
  const confirmed = await confirmModal({
    title: 'Save settings and restart?',
    message: 'The server will restart to apply your changes. Players will be briefly disconnected.',
    confirmText: 'Save & Restart',
  });
  if (!confirmed) return;

  const btn = document.getElementById('saveSettings');
  const restore = withButtonSpinner(btn, 'Saving…');
  try {
    const data = await apiFetch('/settings', { method: 'PUT', body: collect() });
    values = data.env;
    toast(data.applied ? 'Settings saved. Server is restarting…' : (data.note || 'Settings saved.'), 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}
