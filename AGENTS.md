# AGENTS.md — DockCraft

> This file is the authoritative reference for AI coding agents working on the DockCraft project. Read it fully before writing, editing, or refactoring any code.

---

## 1. What is DockCraft?

DockCraft is a **self-hosted web dashboard and controller** for running a Minecraft Bedrock Dedicated Server inside Docker. It is designed to be **beginner server-creator friendly** — meaning non-technical users should be able to launch, configure, and manage a Bedrock server entirely through the UI without ever touching a terminal, a config file, or a docker command directly.

DockCraft wraps the [`itzg/minecraft-bedrock-server`](https://github.com/itzg/docker-minecraft-bedrock-server) Docker image with a polished admin dashboard built on the [`Adminator`](https://github.com/puikinsh/Adminator-admin-dashboard) Bootstrap 5 template. It also includes a **Bedrock mod/addon marketplace and installer** — its primary differentiator from other server managers.

---

## 2. Technology Stack

### Frontend
| Concern | Choice | Notes |
|---|---|---|
| UI Template | [Adminator v3](https://github.com/puikinsh/Adminator-admin-dashboard) | Bootstrap 5, vanilla JS (zero jQuery, zero lodash), dark mode built-in, Webpack 5 build system |
| CSS Framework | Bootstrap 5.3.x | Included via Adminator |
| Charting | Chart.js 4.x | Included via Adminator |
| Real-time | Socket.io client | For live console log streaming and server stats |
| Icons | Font Awesome + Themify Icons | Included via Adminator |
| Build Tool | Webpack 5 (via Adminator's config) | `npm start` for dev, `npm run build` for production |

### Backend
| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 18+ | LTS |
| Framework | Express.js | Lightweight, well-known |
| Docker SDK | [Dockerode](https://github.com/apocas/dockerode) | Programmatic Docker control — never shell out to the Docker CLI |
| Real-time | Socket.io (server) | Paired with the frontend client |
| Config storage | `dockcraft.config.json` (flat file) | No database for MVP. Stores DockCraft's own preferences, container name, volume path, etc. |
| Auth | JWT (jsonwebtoken) + bcrypt | Simple username/password, token stored in localStorage. Add auth after core features work. |

### Infrastructure
| Concern | Choice |
|---|---|
| Minecraft server | `itzg/minecraft-bedrock-server` (latest) |
| Containerization | Docker + Docker Compose |
| DockCraft itself | Runs as its own Docker container, on the same Docker network as the Minecraft container |
| Volume strategy | Bind mount (`./data:/data`) — NOT a named volume. This lets the Node backend read/write files directly from the host filesystem. |

---

## 3. The Minecraft Docker Image

**Image:** `itzg/minecraft-bedrock-server`
**Repo:** https://github.com/itzg/docker-minecraft-bedrock-server

### Critical facts every agent must know:

- The Bedrock server binary is **not bundled** in the image. It is downloaded from Mojang on every container start. Setting `VERSION=LATEST` (the default) auto-upgrades on each start.
- All `server.properties` settings are controlled via **environment variables** (e.g. `GAMEMODE`, `DIFFICULTY`, `MAX_PLAYERS`, `LEVEL_NAME`, `LEVEL_SEED`, `SERVER_NAME`, etc.). DockCraft's backend updates these env vars and restarts the container — it never edits `server.properties` directly.
- The container exposes **UDP port 19132** only. Must be mapped as `-p 19132:19132/udp`.
- `EULA=TRUE` is required or the server will not start.
- The `/data` volume contains everything: the server binary, `server.properties`, worlds, packs, and allowlist.
- Server commands are sent via `docker exec CONTAINER send-command <command>` — this is how DockCraft sends console commands (op, gamerule, kick, etc.).
- Container logs (`docker logs --follow`) are the source of truth for: player join/leave events, chat, errors, and server status.
- Permissions use **XUIDs** (Microsoft account IDs), not usernames. XUIDs can be looked up via the [MCProfile API](https://mcprofile.io/).
- The repo includes `property-definitions.json` — a machine-readable schema of all server properties with their types, defaults, and descriptions. **Use this file to drive the settings UI dynamically** rather than hard-coding form fields.

### Key environment variables (subset):
```
EULA=TRUE
VERSION=LATEST
SERVER_NAME=DockCraft Server
GAMEMODE=survival           # survival | creative | adventure
DIFFICULTY=normal           # peaceful | easy | normal | hard
MAX_PLAYERS=10
ONLINE_MODE=true
ALLOW_LIST=false
ALLOW_LIST_USERS=player1:XUID,player2:XUID
OPS=XUID1,XUID2
LEVEL_NAME=Bedrock level
LEVEL_SEED=
LEVEL_TYPE=DEFAULT          # DEFAULT | FLAT | LEGACY
WHITE_LIST=false
SERVER_PORT=19132
VIEW_DISTANCE=32
TICK_DISTANCE=4
PLAYER_IDLE_TIMEOUT=30
TZ=America/Chicago
```

### Mod/Addon installation (how it works natively):
1. `.mcaddon` files → extract into `/data/behavior_packs/` or `/data/resource_packs/`
2. `.mcpack` files → extract into `/data/resource_packs/`
3. Both formats are renamed `.zip` files — treat them as such
4. Each pack has a `manifest.json` inside with: `header.uuid`, `header.version`, `header.name`, `header.description`
5. To activate a pack, add an entry to `/data/worlds/$LEVEL_NAME/world_behavior_packs.json` or `world_resource_packs.json`:
```json
[
  {
    "pack_id": "the-uuid-from-manifest",
    "version": [1, 0, 0]
  }
]
```
6. Restart the server to apply packs.
7. To force resource pack on all clients: set `texturepack-required=true` in `server.properties`.

---

## 4. Project Structure

```
dockcraft/
├── AGENTS.md                  ← You are here
├── docker-compose.yml         ← Launches DockCraft + Minecraft together
├── .env                       ← Host-level env vars (ports, paths, secrets)
│
├── frontend/                  ← Adminator-based UI (forked/extended)
│   ├── src/
│   │   ├── assets/
│   │   │   ├── scripts/       ← Vanilla JS modules (one per feature)
│   │   │   │   ├── console.js
│   │   │   │   ├── dashboard.js
│   │   │   │   ├── players.js
│   │   │   │   ├── marketplace.js
│   │   │   │   ├── mods.js
│   │   │   │   ├── worlds.js
│   │   │   │   └── settings.js
│   │   │   └── styles/        ← SCSS files, extending Adminator's variables
│   │   └── pages/             ← HTML pages (one per route)
│   │       ├── index.html           ← Dashboard
│   │       ├── console.html
│   │       ├── players.html
│   │       ├── mods.html            ← Installed mods manager
│   │       ├── marketplace.html     ← Mod marketplace
│   │       ├── worlds.html
│   │       ├── settings.html
│   │       └── setup.html           ← First-run wizard
│   ├── webpack.config.js
│   └── package.json
│
├── backend/                   ← Node.js + Express API
│   ├── index.js               ← Entry point, Express + Socket.io setup
│   ├── docker.js              ← Dockerode singleton and helper wrappers
│   ├── config.js              ← Read/write dockcraft.config.json
│   ├── routes/
│   │   ├── server.js          ← GET/POST start, stop, restart, status
│   │   ├── console.js         ← POST send-command; Socket.io log streaming
│   │   ├── players.js         ← GET/POST allowlist, permissions, XUID lookup
│   │   ├── worlds.js          ← GET list, POST backup, POST restore
│   │   ├── mods.js            ← GET/POST/DELETE installed packs
│   │   ├── marketplace.js     ← GET registry, POST install-from-url
│   │   └── settings.js        ← GET/PUT server properties (env vars)
│   ├── services/
│   │   ├── logParser.js       ← Parses container log lines into structured events
│   │   ├── packManager.js     ← Handles pack extraction, manifest reading, JSON updates
│   │   ├── backupManager.js   ← Zip/unzip world directories
│   │   └── xuIdLookup.js      ← Proxies mcprofile.io API
│   ├── dockcraft.config.json  ← Runtime config (gitignored, created on first run)
│   └── package.json
│
├── marketplace/               ← Curated pack registry (can be hosted separately)
│   ├── packs.json             ← Master list of available packs
│   └── schema.md              ← Pack entry schema documentation
│
└── data/                      ← Bind-mounted as /data in the Minecraft container
    ├── server.properties      ← Managed by the itzg image
    ├── allowlist.json         ← Managed by DockCraft backend
    ├── permissions.json       ← Managed by DockCraft backend
    ├── behavior_packs/
    ├── resource_packs/
    └── worlds/
```

---

## 5. Docker Compose Setup

```yaml
# docker-compose.yml
services:

  dockcraft:
    build: ./backend
    ports:
      - "3000:3000"         # DockCraft dashboard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Required for Dockerode
      - ./data:/data        # Shared with minecraft container
      - ./backend/dockcraft.config.json:/app/dockcraft.config.json
    environment:
      - MINECRAFT_CONTAINER_NAME=dockcraft-mc
      - DATA_PATH=/data
    depends_on:
      - minecraft
    restart: unless-stopped

  minecraft:
    image: itzg/minecraft-bedrock-server
    container_name: dockcraft-mc
    ports:
      - "19132:19132/udp"
    volumes:
      - ./data:/data
    environment:
      EULA: "TRUE"
      VERSION: "LATEST"
      SERVER_NAME: "DockCraft Server"
      GAMEMODE: "survival"
      DIFFICULTY: "normal"
      MAX_PLAYERS: "10"
    stdin_open: true
    tty: true
    restart: unless-stopped
```

**Important:** DockCraft mounts the Docker socket (`/var/run/docker.sock`) to control the Minecraft container via Dockerode. It also mounts the same `./data` directory as the Minecraft container so it can read/write pack files, world files, and allowlist directly.

---

## 6. Backend API Routes

All routes are prefixed with `/api`. All responses are JSON.

### Server Control (`/api/server`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/server/status` | Returns container state, uptime, player count, CPU %, memory % |
| POST | `/api/server/start` | Starts the Minecraft container |
| POST | `/api/server/stop` | Stops the Minecraft container |
| POST | `/api/server/restart` | Restarts the Minecraft container |

### Console (`/api/console`)
| Method | Path | Description |
|---|---|---|
| POST | `/api/console/command` | Body: `{ command: "gamerule dofiretick false" }` — runs via `send-command` |
| GET | `/api/console/logs` | Returns last N log lines (for initial page load) |

Socket.io event `console:line` is emitted to clients for each new log line.

### Settings (`/api/settings`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/settings` | Returns current env var config for the Minecraft container |
| PUT | `/api/settings` | Body: key/value map of env vars. Updates container config and restarts. |
| GET | `/api/settings/schema` | Returns parsed `property-definitions.json` for dynamic form generation |

### Players (`/api/players`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/players/online` | Returns currently online players (parsed from logs) |
| GET | `/api/players/allowlist` | Returns `allowlist.json` contents |
| POST | `/api/players/allowlist` | Adds a player. Body: `{ name, xuid }` |
| DELETE | `/api/players/allowlist/:xuid` | Removes a player |
| GET | `/api/players/xuid/:gamertag` | Proxies MCProfile lookup for a gamertag |
| GET | `/api/players/permissions` | Returns `permissions.json` |
| PUT | `/api/players/permissions` | Updates op/member/visitor lists |

### Worlds (`/api/worlds`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/worlds` | Lists world directories in `/data/worlds/` |
| POST | `/api/worlds/backup` | Zips current world, saves to `/data/backups/` with timestamp |
| GET | `/api/worlds/backups` | Lists available backups |
| POST | `/api/worlds/restore` | Body: `{ filename }` — stops server, restores backup, restarts |
| POST | `/api/worlds/upload` | Multipart upload of a world zip |

### Mods (`/api/mods`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/mods` | Lists all installed behavior and resource packs with enable/disable status |
| POST | `/api/mods/upload` | Multipart upload of `.mcaddon` / `.mcpack` — extracts, reads manifest, registers |
| POST | `/api/mods/install-url` | Body: `{ url }` — downloads and installs a pack from a URL |
| PUT | `/api/mods/:uuid/toggle` | Enables or disables a pack (updates world JSON files) |
| DELETE | `/api/mods/:uuid` | Removes a pack entirely |

### Marketplace (`/api/marketplace`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/marketplace` | Returns the curated pack registry (fetched/cached from `marketplace/packs.json`) |
| POST | `/api/marketplace/install/:id` | Installs a marketplace pack by its registry ID |

---

## 7. Frontend Pages & Behavior

### General Rules
- All pages extend Adminator's sidebar + topbar layout. Do not redesign the chrome.
- Use Adminator's existing CSS variables (`--c-bkg-card`, `--c-text-base`, `--c-border`, `--c-primary`) for all custom styles. Never hardcode colors.
- Dark mode works automatically via Adminator's theme system — do not re-implement it.
- Fetch data from the backend API using `fetch()`. Use `async/await`. Handle loading and error states on every call.
- Socket.io is available globally via the CDN include in the layout.
- Keep JavaScript modular — one JS file per page in `src/assets/scripts/`.

### `index.html` — Dashboard
- Stat cards: Server Status, Players Online, CPU Usage, Memory Usage, Uptime
- Recent Events feed (player joins/leaves, parsed from Socket.io log stream)
- Quick action buttons: Start, Stop, Restart (with Bootstrap confirm modals)
- Auto-refreshes stats every 10 seconds via polling `/api/server/status`

### `console.html` — Live Console
- Scrolling log output area styled like a terminal (dark background, monospace font) — reuse Adminator's chat widget structure
- Color-coded lines: `INFO` (white), `WARN` (yellow), `ERROR` (red), player join (green), player leave (orange)
- Command input at the bottom, sends to `POST /api/console/command`
- Connect to Socket.io on page load, listen for `console:line` events
- "Clear" button to wipe the display (client-side only)

### `settings.html` — Server Settings
- Fetch schema from `/api/settings/schema` (derived from `property-definitions.json`) to **dynamically render** form fields
- Group settings into tabs: General, Gameplay, Players, Network, Advanced
- Plain-English labels: map env var names to human-friendly labels and descriptions
- Show current values fetched from `/api/settings`
- "Save & Restart" button at the bottom — PUT to `/api/settings`, then show a restart progress indicator
- Danger zone section (collapsible) for destructive settings

### `players.html` — Player Manager
- Two tabs: Online Players, Allowlist
- Online players table: gamertag, join time, permission level
- Allowlist: add player by gamertag (auto-lookup XUID via `/api/players/xuid/:gamertag`), remove with confirm dialog
- Permission level badges (Operator, Member, Visitor) with edit capability

### `worlds.html` — World Manager
- Current world info card (name, seed, type)
- "Create Backup" button with spinner, shows last backup time
- Backups table with restore/download/delete per entry
- Upload World section (drag-and-drop zip)
- Warning banners: "Server will be stopped during restore"

### `mods.html` — Installed Mods
- Grid of installed pack cards showing: name, description, version, type (behavior/resource), enabled toggle
- Enable/disable toggles write to world pack JSON files and prompt restart
- Upload new pack via drag-and-drop (`.mcaddon` / `.mcpack`)
- Delete pack with confirm dialog
- Empty state with a link to the Marketplace

### `marketplace.html` — Mod Marketplace
- Search/filter bar with category tags (QOL, Survival, Creative, Minigames, Resource)
- Card grid fetched from `/api/marketplace`
- Each card: thumbnail, name, author, description, category badge, "Install" button
- Install button shows progress then flips to "Installed ✓"
- Banner at top: "Mods are sourced from the community. DockCraft does not host these files."

### `setup.html` — First-Run Wizard
- Shown automatically if `dockcraft.config.json` does not exist or `setupComplete: false`
- Step 1: Name your server, pick gamemode, difficulty, max players
- Step 2: Set a port (default 19132), toggle online mode, optional allowlist
- Step 3: Review summary → "Launch Server" button
- Writes settings to DockCraft config and fires `POST /api/server/start`
- After success, redirect to `index.html`

---

## 8. Real-time Architecture (Socket.io)

The backend attaches Socket.io to the Express HTTP server. On the `minecraft:logs` namespace:

```js
// Backend: stream container logs to all connected clients
const logStream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 100 });
logStream.on('data', (chunk) => {
  const line = chunk.toString('utf8').trim();
  io.emit('console:line', { text: line, timestamp: Date.now() });
  logParser.parse(line); // also updates in-memory player list, emits player events
});

// Backend: emit structured player events
io.emit('player:join', { name: 'Steve', xuid: '...' });
io.emit('player:leave', { name: 'Steve' });
io.emit('server:stats', { cpu: 12.4, memory: 34.1, uptime: 3600 });
```

Stats (`server:stats`) are emitted every 5 seconds using Dockerode's `container.stats()` stream.

---

## 9. Log Parser (`services/logParser.js`)

The Bedrock server logs are the only source of runtime truth. Parse them with regex:

```js
// Player joined
/Player connected: (.+), xuid: (\d+)/

// Player left
/Player disconnected: (.+), xuid: (\d+)/

// Server started and ready
/Server started\./

// Version line
/Version: (\d+\.\d+\.\d+\.\d+)/

// WARNING / ERROR prefixes
/\[(?:WARNING|ERROR)\]/
```

The logParser maintains an in-memory `onlinePlayers` Map (`xuid → { name, joinedAt }`) and exposes it to the `/api/players/online` route.

---

## 10. Pack Manager (`services/packManager.js`)

Core responsibilities:

1. **Read a pack file** — accept a path to a `.mcaddon`, `.mcpack`, or `.zip` file
2. **Extract** — use `adm-zip` or `node:zlib` + `node:fs` to unzip
3. **Parse manifest** — read `manifest.json`, extract `header.uuid`, `header.version` (array), `header.name`, `header.description`, `modules[0].type` (`data` = behavior, `resources` = resource)
4. **Copy to correct directory** — behavior → `/data/behavior_packs/`, resource → `/data/resource_packs/`
5. **Register** — read the world's pack JSON, add entry if not present, write back
6. **Return metadata** — name, uuid, version, type, description

For toggling a pack on/off: read the world JSON, add or remove the entry, write back. Do not delete the pack files from disk.

---

## 11. Marketplace Registry Schema

`marketplace/packs.json`:

```json
{
  "updated": "2025-01-01",
  "packs": [
    {
      "id": "ops-one-player-sleep",
      "name": "One Player Sleep",
      "author": "FoxyNoTail",
      "description": "Allows one player to skip the night instead of requiring everyone to sleep.",
      "category": "qol",
      "type": "behavior",
      "version": "3.0.0",
      "thumbnail": "https://example.com/thumb.png",
      "downloadUrl": "https://foxynotail.com/addons/ops/download/latest",
      "sourceUrl": "https://foxynotail.com/addons/ops/",
      "minecraftVersion": "1.20.0",
      "tags": ["sleep", "survival", "qol"]
    }
  ]
}
```

Categories: `qol`, `survival`, `creative`, `minigames`, `resource`, `utility`
Types: `behavior`, `resource`, `both`

---

## 12. Beginner-Friendliness Rules

These are non-negotiable design constraints, not suggestions:

1. **No terminal instructions in the UI.** If a user needs to take action, provide a button or form. Never show a docker command and tell them to run it.
2. **All destructive actions require a confirmation modal.** Stop server, restore backup, delete pack, remove player — all require explicit confirmation with a description of what will happen.
3. **Every async operation shows feedback.** Buttons get a spinner while loading. Show success/error toasts after completion. Never leave the user guessing.
4. **Settings use plain English.** Map env var names to human-readable labels. Every field has a one-sentence tooltip. Group related settings together. Put advanced/dangerous settings behind a collapsible "Advanced" section.
5. **XUID complexity is hidden.** When adding a player, the user types a gamertag. DockCraft looks up the XUID automatically. The user never sees or types a XUID.
6. **First-run wizard gates the app.** If `setupComplete` is false in config, redirect all routes to `/setup.html`. The wizard must complete before anything else is accessible.
7. **The dashboard must be meaningful at a glance.** Status, player count, and quick actions should be visible without scrolling. Assume the user's first question is always "is my server running and who's online?"

---

## 13. Error Handling Conventions

- All API routes return `{ success: true, data: ... }` or `{ success: false, error: "Human-readable message" }`.
- HTTP status codes must be semantically correct: 200, 400, 404, 500.
- Docker errors (container not found, daemon unreachable) must be caught and returned as 503 with a clear message.
- Frontend: catch all `fetch()` calls, show an error toast on failure. Never silently fail.
- Log all backend errors to console with context (route, action, error message). Do not log sensitive values.

---

## 14. What NOT to Do

- **Do not** use jQuery anywhere. Adminator v3 is 100% vanilla JS. Keep it that way.
- **Do not** shell out to the Docker CLI (`child_process.exec('docker ...')`). Use Dockerode exclusively.
- **Do not** edit `server.properties` directly. All server config goes through environment variables on the container.
- **Do not** use a database (PostgreSQL, SQLite, MongoDB) for MVP. Flat JSON files only.
- **Do not** add a frontend framework (React, Vue, Svelte). Adminator is HTML + vanilla JS + Bootstrap. Extend it that way.
- **Do not** hardcode the Minecraft container name. It comes from `dockcraft.config.json` → `containerName`, which defaults to `dockcraft-mc`.
- **Do not** mount named Docker volumes for `/data`. Always use a bind mount so the backend can access files directly.
- **Do not** write new SCSS that references hardcoded hex colors. Always use Adminator's CSS variables.

---

## 15. Key External References

| Resource | URL |
|---|---|
| Adminator GitHub | https://github.com/puikinsh/Adminator-admin-dashboard |
| Adminator Docs | https://puikinsh.github.io/Adminator-admin-dashboard/ |
| itzg/minecraft-bedrock-server | https://github.com/itzg/docker-minecraft-bedrock-server |
| Bedrock server.properties reference | https://minecraft.wiki/w/Server.properties#Option_keys |
| Dockerode | https://github.com/apocas/dockerode |
| Socket.io docs | https://socket.io/docs/v4/ |
| MCProfile XUID lookup | https://mcprofile.io/ |
| MCPEDL (community mods) | https://mcpedl.com/ |
| Bedrock Tweaks (resource packs) | https://bedrocktweaks.net/ |
| FoxyNoTail addons | https://foxynotail.com/addons/ |

---

*Last updated: May 2026. This document should be updated whenever a major architectural decision changes.*
