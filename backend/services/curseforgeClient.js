/**
 * curseforgeClient.js — key-less CurseForge metadata via the cfwidget proxy.
 *
 * Direct CurseForge requests are blocked by Cloudflare (403) from a server, and
 * the official API needs a key. `api.cfwidget.com` is a free JSON proxy that
 * mirrors CurseForge project data without a key. We read each project from it,
 * normalise the fields the marketplace needs, and construct a DIRECT download
 * URL on forgecdn.net from the latest file id — no redirect, no ad-gate.
 *
 *   fileId 8163566 -> https://edge.forgecdn.net/files/8163/566/<name>
 *
 * cfwidget crawls projects on demand: the first request for an uncrawled
 * project returns HTTP 202 ("in queue"). We retry a few times with backoff.
 */

const CFWIDGET_BASE = 'https://api.cfwidget.com';
const CURSEFORGE_BASE = 'https://www.curseforge.com';
const CDN_HOSTS = ['https://edge.forgecdn.net', 'https://mediafilez.forgecdn.net'];
const USER_AGENT =
  'Mozilla/5.0 (compatible; DockCraft/1.0; +https://github.com/dockcraft)';

/** Build the direct forgecdn URL for a CurseForge file id + name. */
function buildDownloadUrl(fileId, fileName, host = CDN_HOSTS[0]) {
  const id = Number(fileId);
  const a = Math.floor(id / 1000);
  const b = id % 1000;
  // forgecdn encodes spaces as %20 but leaves most other chars intact.
  const encoded = encodeURIComponent(fileName).replace(/%2B/g, '+');
  return `${host}/files/${a}/${b}/${encoded}`;
}

/** Pull forgecdn image URLs out of the description HTML for a gallery. */
function extractImages(html) {
  if (!html) return [];
  const out = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    // Skip the small inline icons; keep real screenshots/attachments.
    if (/forgecdn\.net|cloudfront/i.test(src) && !out.includes(src)) out.push(src);
  }
  return out.slice(0, 12);
}

/** Derive a human version label (e.g. "v1.1.10") from a file name. */
function versionFromFileName(name) {
  if (!name) return '';
  const m = name.match(/v?(\d+\.\d+(?:\.\d+)?)/);
  return m ? `v${m[1]}` : '';
}

function slugFromPath(p) {
  return String(p).split('/').filter(Boolean).pop();
}

async function fetchJson(url, { retries = 4, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 202 = cfwidget is crawling the project; wait and retry.
      if (res.status === 202) {
        await delay(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`cfwidget returned ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await delay(1000 * (attempt + 1));
    }
  }
  throw lastErr || new Error('cfwidget request failed');
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Normalise a cfwidget project payload into a marketplace pack. */
function normalize(path, data) {
  const slug = slugFromPath(path);
  const file = data.download || (data.files && data.files[0]) || null;
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const author =
    (data.members && data.members.find((m) => m.title === 'Owner')) ||
    (data.members && data.members[0]) ||
    null;

  const pack = {
    id: slug,
    projectId: data.id || null,
    name: data.title || slug,
    summary: data.summary || '',
    description: data.description || '',
    author: author ? author.username : 'Unknown',
    categories,
    category: categories[0] || 'Addons',
    thumbnail: data.thumbnail || '',
    images: extractImages(data.description),
    mcVersions: file && Array.isArray(file.versions) ? file.versions : [],
    version: file ? versionFromFileName(file.name) : '',
    fileId: file ? file.id : null,
    fileName: file ? file.name : null,
    fileSize: file ? file.filesize : null,
    downloads: data.downloads ? data.downloads.total : null,
    sourceUrl:
      (data.urls && data.urls.curseforge) || `${CURSEFORGE_BASE}/${path}`,
    fileUrl: file ? file.url : `${CURSEFORGE_BASE}/${path}/files`,
    downloadUrl: file && file.id ? buildDownloadUrl(file.id, file.name) : null,
    scrapedAt: new Date().toISOString(),
  };
  return pack;
}

/** Fetch + normalise a single CurseForge project by path. */
async function fetchProject(path) {
  const data = await fetchJson(`${CFWIDGET_BASE}/${path}`);
  return normalize(path, data);
}

/**
 * Fetch all projects with limited concurrency. Returns { packs, errors } so a
 * single failing source never aborts the whole refresh.
 */
async function fetchAll(paths, { concurrency = 3 } = {}) {
  const packs = [];
  const errors = [];
  const queue = [...paths];

  async function worker() {
    while (queue.length) {
      const path = queue.shift();
      try {
        packs.push(await fetchProject(path));
      } catch (err) {
        errors.push({ path, error: err.message });
        console.error(`[curseforge] Failed to fetch ${path}:`, err.message);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, paths.length) }, worker);
  await Promise.all(workers);
  // Preserve the source order rather than completion order.
  const order = paths.map(slugFromPath);
  packs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { packs, errors };
}

module.exports = {
  fetchProject,
  fetchAll,
  buildDownloadUrl,
  CDN_HOSTS,
  USER_AGENT,
};
