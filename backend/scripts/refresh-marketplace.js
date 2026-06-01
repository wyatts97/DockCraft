/**
 * refresh-marketplace.js — headless marketplace refresh.
 *
 * Re-scrapes every CurseForge source listed in marketplace/sources.json via the
 * cfwidget proxy and writes the result to the marketplace cache. Useful for a
 * cron job or a manual one-off:  npm run refresh:marketplace
 */

const cache = require('../services/marketplaceCache');

(async () => {
  console.log('[refresh] Scraping CurseForge sources via cfwidget…');
  try {
    const registry = await cache.refresh();
    console.log(`[refresh] Done. ${registry.packs.length} pack(s) cached at ${registry.updated}.`);
    if (registry.errors && registry.errors.length) {
      console.warn(`[refresh] ${registry.errors.length} source(s) failed:`);
      for (const e of registry.errors) console.warn(`  - ${e.path}: ${e.error}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('[refresh] Failed:', err.message);
    process.exit(1);
  }
})();
