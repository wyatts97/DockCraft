# DockCraft

A self-hosted web dashboard for running and managing a **Minecraft Bedrock
Dedicated Server** in Docker — no terminal required.

DockCraft wraps the [`itzg/minecraft-bedrock-server`](https://github.com/itzg/docker-minecraft-bedrock-server)
image with a polished admin UI (built on the
[Adminator](https://github.com/puikinsh/Adminator-admin-dashboard) template) and
adds a community **mod/add-on marketplace and installer**.

## Features

- **Dashboard** — server status, player count, CPU/memory, uptime, live event feed, and start/stop/restart controls.
- **Live console** — color-coded log stream over WebSockets, with a command input.
- **Players** — see who's online and manage the allowlist by gamertag (XUID lookup is automatic).
- **Settings** — plain-English, schema-driven server settings grouped into tabs ("Save & Restart").
- **Worlds** — create/restore/download/delete backups and upload a world.
- **Mods** — install `.mcaddon`/`.mcpack` packs, toggle them on/off, and delete them.
- **Marketplace** — browse popular CurseForge add-ons and one-click install them.
- **First-run wizard** + **JWT login** to gate access.

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Adminator v4 (vanilla JS, CSS variables, Webpack 5), Socket.io client |
| Backend | Node.js 18+ + Express, [Dockerode](https://github.com/apocas/dockerode), Socket.io, JWT (bcrypt) |
| Config | Flat file `dockcraft.config.json` (no database) |
| Minecraft | `itzg/minecraft-bedrock-server` controlled via the Docker API |

DockCraft controls the Minecraft container through the mounted Docker socket and
shares the `./data` bind mount so it can read/write worlds, packs, and the
allowlist directly. It never shells out to the Docker CLI and never edits
`server.properties` directly — all server config flows through container
environment variables.

## Quick Start

### Prerequisites

- [Docker Engine](https://docs.docker.com/engine/install/) + [Docker Compose](https://docs.docker.com/compose/install/)
- Linux, macOS, or Windows with WSL2

### 1. Clone and configure

```bash
git clone https://github.com/wyatts97/DockCraft.git
cd DockCraft
```

Copy the example environment file and set `HOST_DATA_PATH` to the **absolute path**
of the `./data` folder on your host. This is required so DockCraft can recreate
the Minecraft container with the correct bind mount when you change settings.

```bash
cp .env.example .env
```

**Linux / macOS**
```bash
# Edit .env
HOST_DATA_PATH=/home/you/DockCraft/data
```

**Windows (PowerShell)**
```powershell
# Edit .env
HOST_DATA_PATH=C:\Users\You\DockCraft\data
```

### 2. Build and launch

```bash
docker compose up -d --build
```

This starts two containers:

| Container | Purpose | Exposed Port |
|---|---|---|
| `dockcraft` | Dashboard & controller | `3000/tcp` |
| `dockcraft-mc` | Minecraft Bedrock server | `19132/udp` |

The first start downloads the Bedrock server binary from Mojang, so give it a
minute before the server is reachable.

### 3. Open the dashboard

Navigate to `http://localhost:3000` (or your server's IP). You'll be guided
through a first-run wizard to create an admin account.

## Local Development

Run the frontend and backend separately:

```bash
# Backend (API on :3000)
cd backend
npm install
npm run dev

# Frontend (Webpack dev server with hot reload)
cd frontend
npm install
npm start
```

For a production-style local run, build the frontend and let the backend serve it:

```bash
cd frontend && npm run build
cd ../backend && npm start   # serves frontend/dist + the API on :3000
```

> Without a reachable Docker daemon, the API still boots: server status reports
> `absent`, and Docker-dependent actions return clear `503` errors.

## Configuration

`backend/dockcraft.config.json` is created on first run (gitignored). In Docker
it's persisted inside the shared `/data` volume (`CONFIG_PATH`). It stores:

- `containerName` — the Minecraft container to control (default `dockcraft-mc`)
- `admin` — username + bcrypt password hash (created by the setup wizard)
- `jwtSecret` — token signing secret (auto-generated if not provided)
- `env` — the environment-variable map applied to the Minecraft container

## API Overview

All routes are under `/api` and return `{ success, data }` or
`{ success, error }`. Auth routes (`/api/auth`, `/api/setup`) are public; the
rest require a Bearer token.

| Area | Routes |
|---|---|
| **Server** | `GET /server/status`, `POST /server/{start,stop,restart}` |
| **Console** | `POST /console/command`, `GET /console/logs` (live via Socket.io `console:line`) |
| **Settings** | `GET /settings`, `GET /settings/schema`, `PUT /settings` |
| **Players** | `GET /players/online`, allowlist CRUD, `GET /players/xuid/:gamertag`, permissions |
| **Worlds** | list, `POST /worlds/backup`, backups list/restore/download/delete, upload |
| **Mods** | list, `POST /mods/upload`, `POST /mods/install-url`, `PUT /mods/:uuid/toggle`, `DELETE /mods/:uuid` |
| **Marketplace** | `GET /marketplace`, `POST /marketplace/refresh`, `POST /marketplace/install/:id` |

## Project Layout

```
DockCraft/
├── docker-compose.yml      # launches DockCraft + Minecraft
├── backend/                # Express + Dockerode API + Socket.io
│   ├── index.js            # entry: routes, auth guard, static serve, realtime
│   ├── docker.js           # Dockerode helpers (status, lifecycle, exec, recreate)
│   ├── config.js           # flat-file config
│   ├── routes/             # one file per API area
│   ├── services/           # logParser, packManager, backupManager, xuidLookup, curseforgeClient, marketplaceCache
│   └── schema/             # property-definitions.json (settings schema)
├── frontend/               # Adminator v4 UI (forked + extended)
│   └── src/assets/scripts/dockcraft/  # api.js, socket.js, modal.js, pages/*
└── marketplace/            # CurseForge sources (sources.json) + cached snapshot (packs.json)
```

## Troubleshooting

**Minecraft server not showing as "running"**

Check that the Docker socket is mounted (`/var/run/docker.sock:/var/run/docker.sock`)
and that the `dockcraft-mc` container name matches `MINECRAFT_CONTAINER_NAME` in
`docker-compose.yml`.

**Settings changes don't persist**

Ensure `HOST_DATA_PATH` in `.env` points to the absolute path of `./data`. A
relative path will break bind mounts when the container is recreated.

See `AGENTS.md` for the full design spec and contributor guidelines.
