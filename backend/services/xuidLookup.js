/**
 * xuidLookup.js — resolve a Bedrock gamertag to its XUID.
 *
 * Bedrock permissions/allowlist use XUIDs (Microsoft account IDs), not
 * gamertags. Per the beginner-friendliness rules, the user only ever types a
 * gamertag — DockCraft looks up the XUID behind the scenes via the public
 * MCProfile API (https://mcprofile.io/).
 *
 * Uses the global fetch available in Node 18+.
 */

const MCPROFILE_BASE = 'https://mcprofile.io/api/v1/bedrock/gamertag';

async function lookup(gamertag) {
  if (!gamertag || !gamertag.trim()) {
    const e = new Error('A gamertag is required.');
    e.code = 400;
    throw e;
  }
  const url = `${MCPROFILE_BASE}/${encodeURIComponent(gamertag.trim())}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const e = new Error('Could not reach the XUID lookup service. Try again later.');
    e.code = 503;
    throw e;
  }

  if (res.status === 404) {
    const e = new Error(`No Xbox profile found for gamertag "${gamertag}".`);
    e.code = 404;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`XUID lookup failed (status ${res.status}).`);
    e.code = 502;
    throw e;
  }

  const data = await res.json();
  // MCProfile returns { gamertag, xuid, ... }; normalize defensively.
  const xuid = data.xuid || data.XUID || data.id;
  const name = data.gamertag || data.gamerTag || gamertag;
  if (!xuid) {
    const e = new Error('Lookup service returned no XUID.');
    e.code = 502;
    throw e;
  }
  return { name, xuid: String(xuid) };
}

module.exports = { lookup };
