/**
 * marketplace.js (route) — CurseForge-backed pack browser + one-click install.
 *
 * Metadata comes from the key-less cfwidget proxy (see curseforgeClient.js),
 * cached by marketplaceCache.js. Installing downloads the pack directly from
 * forgecdn.net and hands it to packManager. If a download can't be resolved
 * (rare — distribution disabled, CDN miss), we return a `fallback` so the UI
 * can open the CurseForge page for a manual download.
 */

const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const packManager = require('../services/packManager');
const cache = require('../services/marketplaceCache');
const curseforge = require('../services/curseforgeClient');
const { ok, fail } = require('../middleware/auth');

const router = express.Router();

/** GET /api/marketplace — serve the cached registry. */
router.get('/', (req, res) => {
  const registry = cache.read();
  return ok(res, {
    updated: registry.updated,
    source: registry.source || 'curseforge',
    packs: registry.packs,
    errors: registry.errors || [],
  });
});

/** POST /api/marketplace/refresh — re-scrape all sources from CurseForge. */
router.post('/refresh', async (req, res) => {
  try {
    const registry = await cache.refresh();
    return ok(res, {
      updated: registry.updated,
      source: registry.source,
      packs: registry.packs,
      errors: registry.errors,
    });
  } catch (err) {
    return fail(res, `Refresh failed: ${err.message}`, 502);
  }
});

/** Fetch a URL into a Buffer, returning null on a non-OK response. */
async function download(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': curseforge.USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

/** A valid pack archive is a ZIP — it starts with the "PK" magic bytes. */
function isZip(buffer) {
  return buffer && buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** POST /api/marketplace/install/:id — best-effort direct install. */
router.post('/install/:id', async (req, res) => {
  const pack = cache.findById(req.params.id);
  if (!pack) return fail(res, 'Pack not found in the marketplace.', 404);

  // Build the list of CDN URLs to try (primary host, then the alternate).
  const urls = [];
  if (pack.downloadUrl) urls.push(pack.downloadUrl);
  if (pack.fileId && pack.fileName) {
    for (const host of curseforge.CDN_HOSTS) {
      const u = curseforge.buildDownloadUrl(pack.fileId, pack.fileName, host);
      if (!urls.includes(u)) urls.push(u);
    }
  }

  let tmpFile;
  try {
    let buffer = null;
    for (const url of urls) {
      try {
        const b = await download(url);
        if (isZip(b)) { buffer = b; break; }
      } catch {
        // try the next candidate
      }
    }

    if (!buffer) {
      // Couldn't fetch a real archive — let the user grab it manually.
      return res.status(409).json({
        success: false,
        error: 'Automatic download unavailable for this pack.',
        data: { fallback: true, sourceUrl: pack.sourceUrl, fileUrl: pack.fileUrl },
      });
    }

    tmpFile = path.join(os.tmpdir(), `dockcraft-mkt-${Date.now()}.zip`);
    fs.writeFileSync(tmpFile, buffer);
    const installed = packManager.installFromFile(tmpFile, { activate: true });
    if (!installed.length) {
      return fail(res, 'Downloaded file contained no valid pack.', 422);
    }
    return ok(res, { id: pack.id, installed }, 201);
  } catch (err) {
    const code = err.name === 'TimeoutError' ? 504 : 502;
    return fail(res, `Could not install "${pack.name}": ${err.message}`, code);
  } finally {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
  }
});

module.exports = router;
