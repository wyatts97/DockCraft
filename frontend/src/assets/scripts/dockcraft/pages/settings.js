/**
 * settings.js — schema-driven server settings form.
 *
 * Fetches the grouped schema (/settings/schema) and current values
 * (/settings), renders tabbed, plain-English fields with tooltips, and saves
 * via PUT /settings which recreates the container ("Save & Restart").
 */

import { apiFetch, toast, withButtonSpinner } from '../api';
import { escapeHtml } from '../utils';
import { confirmModal } from '../modal';

let schema = null;
let values = {};
let activeTabId = null;

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
  bindProfile();
}

export function destroy() {
  schema = null;
  values = {};
  activeTabId = null;
  closeChangePasswordModal();
}

function renderTabs() {
  const tabsNav = document.getElementById('settingsTabNav');
  const tabsBody = document.getElementById('settingsTabBody');
  if (!tabsNav || !tabsBody) return;

  const groups = schema.groups;
  const initialIdx = activeTabId ? groups.findIndex((g) => g.id === activeTabId) : 0;
  const initial = initialIdx >= 0 ? initialIdx : 0;
  activeTabId = groups[initial].id;

  tabsNav.innerHTML = groups.map((g, i) =>
    `<button class="dc-tab ${i === initial ? 'is-active' : ''}" type="button" data-tab="${escapeHtml(g.id)}" role="tab" aria-selected="${i === initial}" aria-controls="panel-${escapeHtml(g.id)}" id="tab-${escapeHtml(g.id)}">${escapeHtml(g.label)}${g.advanced ? ' ⚠' : ''}</button>`
  ).join('');

  tabsBody.innerHTML = groups.map((g, i) => `
    <div class="dc-tab-panel ${i === initial ? 'is-active' : ''}" data-panel="${g.id}" role="tabpanel" id="panel-${escapeHtml(g.id)}" aria-labelledby="tab-${escapeHtml(g.id)}" ${i === initial ? '' : 'hidden'}>
      ${g.advanced ? '<div class="dc-danger-note">Advanced settings — changing these can break your server. Proceed carefully.</div>' : ''}
      <div class="dc-field-grid">${g.fields.map(renderField).join('')}</div>
    </div>`).join('');

  tabsNav.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
  });
  bindTips(tabsBody);
}

function activateTab(id) {
  activeTabId = id;
  const tabsNav = document.getElementById('settingsTabNav');
  const tabsBody = document.getElementById('settingsTabBody');
  tabsNav.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.getAttribute('data-tab') === id;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on);
  });
  tabsBody.querySelectorAll('[data-panel]').forEach((p) => {
    const on = p.getAttribute('data-panel') === id;
    p.classList.toggle('is-active', on);
    if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
  });
}

function renderField(field) {
  const current = values[field.key] ?? field.default ?? '';
  const tip = escapeHtml(field.description || '');
  const fieldId = `f-${escapeHtml(field.key)}`;
  const labelId = `${fieldId}-label`;
  let control;
  if (field.type === 'boolean') {
    const checked = String(current) === 'true' ? 'checked' : '';
    control = `<label class="dc-switch">
        <input type="checkbox" id="${fieldId}" data-key="${field.key}" data-type="boolean" role="switch" aria-checked="${checked ? 'true' : 'false'}" aria-describedby="${labelId}" ${checked}>
        <span class="dc-switch-track" aria-hidden="true"></span>
        <span class="dc-switch-state" aria-hidden="true">${checked ? 'On' : 'Off'}</span>
      </label>`;
  } else if (field.type === 'enum') {
    control = `<select class="input" id="${fieldId}" data-key="${field.key}" aria-describedby="${labelId}">
        ${field.options.map((o) => `<option value="${escapeHtml(o)}" ${String(current) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
      </select>`;
  } else {
    const type = field.type === 'number' ? 'number' : 'text';
    control = `<input class="input" type="${type}" id="${fieldId}" data-key="${field.key}" value="${escapeHtml(String(current))}" aria-describedby="${labelId}">`;
  }
  return `
    <div class="dc-field">
      <div class="dc-field-label" id="${labelId}">
        <label for="${fieldId}">${escapeHtml(field.label)}</label>
        <button class="dc-tip" type="button" aria-expanded="false" aria-controls="tip-${fieldId}" data-tip="${tip}">?</button>
        <span class="dc-tip-bubble" role="tooltip" id="tip-${fieldId}">${tip}</span>
      </div>
      ${control}
    </div>`;
}

function bindTips(scope) {
  scope.querySelectorAll('.dc-tip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });
    btn.addEventListener('blur', () => btn.setAttribute('aria-expanded', 'false'));
  });
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
    renderTabs();
    toast(data.applied ? 'Settings saved. Server is restarting…' : (data.note || 'Settings saved.'), 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    restore();
  }
}

/* ---------- Profile / change password ---------- */

function bindProfile() {
  try {
    const raw = localStorage.getItem('dockcraft-user');
    if (raw) {
      const u = JSON.parse(raw);
      const name = u.username || u.name || '—';
      const el = document.getElementById('profileName');
      if (el) el.textContent = name;
    }
  } catch { /* ignore */ }
  document.getElementById('changePasswordBtn')?.addEventListener('click', openChangePasswordModal);
  document.addEventListener('keydown', escClosePasswordModal);
}

function ensurePasswordModal() {
  let host = document.getElementById('changePasswordModal');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'changePasswordModal';
  host.className = 'dc-modal';
  host.hidden = true;
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'changePasswordTitle');
  host.innerHTML = `
    <div class="dc-modal-backdrop" data-close></div>
    <div class="dc-modal-panel" tabindex="-1">
      <div class="card-head">
        <div class="card-title-wrap">
          <h2 class="card-title" id="changePasswordTitle">Change password</h2>
        </div>
        <button class="btn btn--ghost btn--sm" type="button" data-close aria-label="Close">✕</button>
      </div>
      <form id="changePasswordForm" class="dc-form" novalidate>
        <div class="dc-field">
          <label for="cpCurrent">Current password</label>
          <input class="input" type="password" id="cpCurrent" name="current" autocomplete="current-password" required>
        </div>
        <div class="dc-field">
          <label for="cpNext">New password</label>
          <input class="input" type="password" id="cpNext" name="next" autocomplete="new-password" minlength="6" required>
          <div class="dc-field-hint">At least 6 characters.</div>
        </div>
        <div class="dc-field">
          <label for="cpConfirm">Confirm new password</label>
          <input class="input" type="password" id="cpConfirm" name="confirm" autocomplete="new-password" minlength="6" required>
        </div>
        <div class="dc-form-error" id="changePasswordError" role="alert" hidden></div>
        <div class="dc-form-actions">
          <button class="btn btn--ghost" type="button" data-close>Cancel</button>
          <button class="btn btn--primary" type="submit">Update password</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(host);
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeChangePasswordModal();
  });
  host.querySelector('#changePasswordForm').addEventListener('submit', onChangePasswordSubmit);
  return host;
}

function openChangePasswordModal() {
  const host = ensurePasswordModal();
  host.hidden = false;
  const form = host.querySelector('#changePasswordForm');
  form.reset();
  const err = host.querySelector('#changePasswordError');
  err.hidden = true; err.textContent = '';
  setTimeout(() => host.querySelector('#cpCurrent')?.focus(), 0);
}

function closeChangePasswordModal() {
  const host = document.getElementById('changePasswordModal');
  if (host) host.hidden = true;
}

function escClosePasswordModal(e) {
  if (e.key !== 'Escape') return;
  const host = document.getElementById('changePasswordModal');
  if (host && !host.hidden) closeChangePasswordModal();
}

async function onChangePasswordSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const err = form.querySelector('#changePasswordError');
  err.hidden = true; err.textContent = '';
  const current = form.current.value;
  const next = form.next.value;
  const confirm = form.confirm.value;
  if (next.length < 6) {
    err.textContent = 'New password must be at least 6 characters.'; err.hidden = false; return;
  }
  if (next !== confirm) {
    err.textContent = 'New password and confirmation do not match.'; err.hidden = false; return;
  }
  const btn = form.querySelector('[type="submit"]');
  const restore = withButtonSpinner(btn, 'Updating…');
  try {
    await apiFetch('/auth/password', { method: 'POST', body: { current, next } });
    toast('Password updated.', 'success');
    closeChangePasswordModal();
  } catch (e2) {
    err.textContent = e2.message || 'Could not update password.'; err.hidden = false;
  } finally {
    restore();
  }
}
