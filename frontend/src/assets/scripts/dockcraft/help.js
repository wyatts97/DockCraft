/**
 * help.js — slide-in help drawer.
 *
 * Adds a "?" button to the topbar that opens a right-hand drawer with two
 * tabs: a glossary of common DockCraft terms and a list of links to the
 * Minecraft wiki, the underlying itzg image, and community mod resources.
 *
 * The drawer is independent of the page module — it lives in document.body
 * and never re-renders, so it survives SPA-style navigations.
 */

import { escapeHtml } from './utils';

const GLOSSARY = [
  { term: 'EULA',     desc: 'Mojang\'s End User License Agreement. The server refuses to start unless EULA=TRUE is set.' },
  { term: 'XUID',     desc: 'A Microsoft account\'s unique ID. Used for allowlist and ban operations because gamertags can change.' },
  { term: 'Allowlist', desc: 'A list of XUIDs allowed to join. Enable in Settings → Players to require explicit approval.' },
  { term: 'OPS',      desc: 'Players with operator permissions. They can run /gamemode, /tp, /give and other admin commands.' },
  { term: 'Packs',    desc: 'Behavior packs add or change gameplay; resource packs change visuals/sounds. Both ship as .mcaddon / .mcpack.' },
  { term: 'World seed', desc: 'A number that deterministically generates the same terrain for every player. Leave blank for random.' },
  { term: 'Tick distance', desc: 'How far around each player the server simulates. Lower = better performance, smaller playable area.' },
  { term: 'View distance', desc: 'How many chunks each client renders. Higher = prettier, more bandwidth.' },
];

const LINKS = [
  { label: 'Bedrock server.properties reference', url: 'https://minecraft.wiki/w/Server.properties' },
  { label: 'itzg/minecraft-bedrock-server (image)', url: 'https://github.com/itzg/docker-minecraft-bedrock-server' },
  { label: 'MCPEDL — community mods and add-ons',   url: 'https://mcpedl.com/' },
  { label: 'Bedrock Tweaks — resource packs',       url: 'https://bedrocktweaks.net/' },
  { label: 'FoxyNoTail addons',                     url: 'https://foxynotail.com/addons/' },
];

function ensureMarkup() {
  if (document.getElementById('dcHelpDrawer')) return;
  const html = `
    <button class="dc-help-toggle" type="button" id="dcHelpToggle" aria-haspopup="dialog" aria-controls="dcHelpDrawer" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
      Help
    </button>
    <div class="dc-help-backdrop" id="dcHelpBackdrop" hidden></div>
    <aside class="dc-help-drawer" id="dcHelpDrawer" role="dialog" aria-modal="true" aria-labelledby="dcHelpTitle" hidden tabindex="-1">
      <div class="dc-help-head">
        <h2 id="dcHelpTitle">Help &amp; reference</h2>
        <button class="dc-welcome-dismiss" type="button" data-help-close aria-label="Close help">✕</button>
      </div>
      <div class="dc-help-tabs" role="tablist" aria-label="Help sections">
        <button class="dc-help-tab is-active" type="button" role="tab" aria-selected="true" data-help-tab="glossary" id="dcHelpTabGlossary">Glossary</button>
        <button class="dc-help-tab" type="button" role="tab" aria-selected="false" data-help-tab="links" id="dcHelpTabLinks">Resources</button>
      </div>
      <div class="dc-help-body">
        <section class="dc-help-section" data-help-pane="glossary" role="tabpanel" aria-labelledby="dcHelpTabGlossary">
          <ul class="dc-help-list">${GLOSSARY.map((g) => `
            <li class="dc-help-term"><strong>${escapeHtml(g.term)}.</strong> <span>${escapeHtml(g.desc)}</span></li>`).join('')}
          </ul>
        </section>
        <section class="dc-help-section" data-help-pane="links" role="tabpanel" aria-labelledby="dcHelpTabLinks" hidden>
          <ul class="dc-help-list">${LINKS.map((l) => `
            <li><a class="dc-help-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M19 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>
              <span>${escapeHtml(l.label)}</span>
            </a></li>`).join('')}
          </ul>
        </section>
      </div>
    </aside>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

function attachToTopbar() {
  // Inject the help toggle into the topbar actions area. If the host doesn't
  // exist (rare), the toggle is still in the DOM and reachable via keyboard.
  const host = document.querySelector('[data-topbar-actions]') || document.querySelector('.d-topbar .d-topbar-actions');
  const btn = document.getElementById('dcHelpToggle');
  if (host && btn) host.appendChild(btn);
}

function bind() {
  const toggle = document.getElementById('dcHelpToggle');
  const drawer = document.getElementById('dcHelpDrawer');
  const backdrop = document.getElementById('dcHelpBackdrop');
  if (!toggle || !drawer || !backdrop) return;

  const setOpen = (on) => {
    drawer.classList.toggle('is-open', on);
    backdrop.classList.toggle('is-open', on);
    drawer.hidden = !on; backdrop.hidden = !on;
    toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) {
      const firstTab = drawer.querySelector('[data-help-tab].is-active');
      (firstTab || drawer).focus({ preventScroll: true });
    } else {
      toggle.focus({ preventScroll: true });
    }
  };

  toggle.addEventListener('click', () => setOpen(!drawer.classList.contains('is-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-help-close]')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false);
  });

  // Tab switching.
  drawer.querySelectorAll('[data-help-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-help-tab');
      drawer.querySelectorAll('[data-help-tab]').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      drawer.querySelectorAll('[data-help-pane]').forEach((p) => {
        const on = p.getAttribute('data-help-pane') === target;
        p.hidden = !on;
      });
    });
  });
}

export function initHelpDrawer() {
  ensureMarkup();
  attachToTopbar();
  bind();
}
