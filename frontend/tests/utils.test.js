/**
 * tests/utils.test.js — coverage for the shared DOM/string helpers in
 * src/assets/scripts/dockcraft/utils.js.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  escapeHtml,
  formatSize,
  formatUptime,
  formatBackupName,
  timeAgo,
  debounce,
  emptyState,
} from '../src/assets/scripts/dockcraft/utils.js';

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('"a" & \'b\'')).toBe('&quot;a&quot; &amp; &#39;b&#39;');
  });
  it('returns "" for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
  it('coerces numbers to strings', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('formatSize', () => {
  it('uses bytes for small values', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
  });
  it('picks the right binary unit', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
  it('returns an em-dash for null/NaN', () => {
    expect(formatSize(null)).toBe('—');
    expect(formatSize(NaN)).toBe('—');
  });
});

describe('formatUptime', () => {
  it('formats days, hours, minutes', () => {
    expect(formatUptime(86400 + 3600 * 4 + 60 * 17)).toBe('1d 4h 17m');
  });
  it('omits zero days/hours', () => {
    expect(formatUptime(7200)).toBe('2h 0m');
  });
  it('returns "—" for invalid input', () => {
    expect(formatUptime(0)).toBe('—');
    expect(formatUptime(null)).toBe('—');
    expect(formatUptime(-5)).toBe('—');
  });
});

describe('formatBackupName', () => {
  it('formats a date as "May 31 · 12:00"', () => {
    // Use local-time components: 2026-05-31 12:00 local.
    const d = new Date(2026, 4, 31, 12, 0);
    expect(formatBackupName(d.toISOString())).toBe('May 31 · 12:00');
  });
  it('returns "—" for invalid input', () => {
    expect(formatBackupName(null)).toBe('—');
    expect(formatBackupName('not-a-date')).toBe('—');
  });
});

describe('timeAgo', () => {
  it('returns "just now" within a minute', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now');
  });
  it('formats minutes, hours, days', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5 minutes ago');
    expect(timeAgo(new Date(now - 60 * 60_000).toISOString())).toBe('1 hour ago');
    expect(timeAgo(new Date(now - 3 * 24 * 60 * 60_000).toISOString())).toBe('3 days ago');
  });
  it('handles 1-minute and 1-hour singular forms', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 60_000).toISOString())).toBe('1 minute ago');
    expect(timeAgo(new Date(now - 60 * 60_000).toISOString())).toBe('1 hour ago');
    expect(timeAgo(new Date(now - 24 * 60 * 60_000).toISOString())).toBe('1 day ago');
  });
});

describe('debounce', () => {
  it('coalesces rapid calls into a single trailing call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1); d(2); d(3);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });
});

describe('emptyState', () => {
  it('renders a card with title, message, and a primary CTA button', () => {
    const click = vi.fn();
    const state = emptyState({
      icon: '★',
      title: 'Nothing here',
      message: 'Try adding one.',
      primaryCta: { label: 'Add item', onClick: click },
    });
    expect(state.html).toContain('Nothing here');
    expect(state.html).toContain('Try adding one.');
    expect(state.html).toContain('Add item');
    // Mount it and bind.
    document.body.innerHTML = `<div id="root">${state.html}</div>`;
    // Re-bind because the document is now populated; the bind() function
    // searches the whole document for #dcEmptyPrimary.
    const root = document.getElementById('root');
    root.innerHTML = state.html;
    state.bind();
    document.getElementById('dcEmptyPrimary').click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('renders a secondary link as an anchor when given an href', () => {
    const state = emptyState({
      icon: '↗',
      title: 'Empty',
      secondaryCta: { label: 'Browse', href: '/marketplace.html' },
    });
    expect(state.html).toContain('<a class="dc-empty-link" href="/marketplace.html">Browse');
  });

  it('renders a string primary CTA as a label span', () => {
    const state = emptyState({
      icon: '⏳',
      title: 'Server stopped',
      message: 'Press Start to boot it up.',
      primaryCta: 'Start the server',
    });
    expect(state.html).toContain('<span class="dc-empty-cta">Start the server</span>');
    expect(state.html).not.toContain('dcEmptyPrimary');
  });

  it('escapes user-supplied strings to prevent XSS', () => {
    const state = emptyState({
      icon: '!',
      title: '<script>alert(1)</script>',
      message: '<img src=x onerror=alert(1)>',
    });
    expect(state.html).not.toContain('<script>');
    expect(state.html).toContain('&lt;script&gt;');
    expect(state.html).toContain('&lt;img');
  });
});
