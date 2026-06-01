# Marketplace Schema

The marketplace is backed by **CurseForge**. We don't hand-write pack entries
anymore — instead we list CurseForge project paths in `sources.json`, and the
backend scrapes their metadata via the key-less [cfwidget](https://www.cfwidget.com)
proxy and caches the result.

- **`sources.json`** (committed, hand-edited) — the list of CurseForge projects to show.
- **`packs.json`** (committed seed, generated) — a snapshot of the last scrape; used as the offline fallback.
- **`DATA_PATH/marketplace-cache.json`** (runtime, gitignored) — the live cache written by Refresh.

DockCraft does **not** host any pack files; it downloads them directly from
`forgecdn.net` at install time.

## `sources.json`

```json
{
  "sources": [
    "minecraft-bedrock/addons/core-craft",
    "minecraft-bedrock/addons/better-on-bedrock"
  ]
}
```

Each entry is the path after the host (i.e. what follows `curseforge.com/` or
`api.cfwidget.com/`). Add or remove entries, then click **Refresh** in the UI or
run `npm run refresh:marketplace` in `backend/`.

## Generated pack fields (in `packs.json` / the cache)

| Field | Type | Description |
|---|---|---|
| `id` | string | CurseForge slug; used in `/api/marketplace/install/:id`. |
| `projectId` | number | CurseForge project id. |
| `name` | string | Display name (cfwidget `title`). |
| `summary` | string | One-line summary shown on the card. |
| `description` | string | Full HTML description (for a future detail view). |
| `author` | string | Project owner. |
| `categories` | string[] | All CurseForge categories (drive the filter chips). |
| `category` | string | Primary category. |
| `thumbnail` | string (URL) | Project avatar; falls back to initials if empty. |
| `images` | string[] | Screenshot URLs parsed from the description. |
| `version` | string | Human version label parsed from the file name (e.g. `v1.1.10`). |
| `mcVersions` | string[] | Supported Bedrock versions. |
| `fileId` | number | Latest file id (used to build the CDN URL). |
| `fileName` | string | Latest file name. |
| `fileSize` | number | File size in bytes. |
| `downloadUrl` | string (URL) | Direct `forgecdn.net` link built from `fileId` + `fileName`. |
| `sourceUrl` | string (URL) | CurseForge project page (used for the install fallback). |
| `fileUrl` | string (URL) | CurseForge file page. |
| `scrapedAt` | string (ISO) | When this entry was scraped. |

## Install behaviour

`POST /api/marketplace/install/:id` downloads `downloadUrl` (trying the alternate
forgecdn host on failure), verifies it's a real ZIP, and installs it via the pack
manager. If no archive can be fetched, it responds `409` with
`{ data: { fallback: true, sourceUrl } }` and the UI opens the CurseForge page so
the user can download manually and install through **Mods → Upload**.
