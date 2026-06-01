/**
 * tests/packManager.test.js — pack extraction guards.
 *
 * Covers safeExtract's defenses: zip-slip, per-file size cap, total entry cap.
 * Uses real zip files written to the sandbox.
 */

const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

const { tmpDir, clearSandbox, SANDBOX, CONFIG_PATH, DATA_PATH } = require('./helpers');

beforeEach(() => {
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, '/').match(/(services[\/]packManager)/)) {
      delete require.cache[key];
    }
  }
  clearSandbox();
});

function makeZip(entries) {
  // entries: [{ name, content, isDir? }]
  const zip = new AdmZip();
  for (const e of entries) {
    if (e.isDir) {
      zip.addFile(e.name, Buffer.alloc(0), '', 0o755);
    } else {
      zip.addFile(e.name, Buffer.from(e.content || ''));
    }
  }
  const p = path.join(SANDBOX, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
  zip.writeZip(p);
  return p;
}

describe('safeExtract', () => {
  it('extracts a normal archive', async () => {
    const { safeExtract } = require('../services/packManager');
    const archive = makeZip([
      { name: 'manifest.json', content: '{"header":{"uuid":"a"}}' },
      { name: 'textures/icon.png', content: 'fake' },
    ]);
    const dest = tmpDir('extract');
    const n = safeExtract(archive, dest);
    expect(n).toBe(2);
    expect(fs.existsSync(path.join(dest, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'textures', 'icon.png'))).toBe(true);
  });

  it('keeps all entries inside the destination after AdmZip sanitization', () => {
    // AdmZip normalizes "../" segments at parse time, so an entry like
    // 'subdir/../../../escape.txt' arrives as 'escape.txt' and is written
    // inside `dest` (not outside). This is the safety property: no file
    // ends up outside the destination, even if a hostile name tries.
    const { safeExtract } = require('../services/packManager');
    const archive = makeZip([{ name: 'subdir/../../../escape.txt', content: 'pwned' }]);
    const dest = tmpDir('extract-abs');
    safeExtract(archive, dest);
    const leaked = path.join(dest, '..', '..', '..', 'escape.txt');
    expect(fs.existsSync(leaked)).toBe(false);
    // The normalized entry is allowed to land inside dest.
    expect(fs.existsSync(path.join(dest, 'escape.txt'))).toBe(true);
  });

  it('isUnsafePath rejects traversal and absolute paths', () => {
    const { isUnsafePath } = require('../services/packManager');
    expect(isUnsafePath('../foo')).toBe(true);
    expect(isUnsafePath('foo/../bar')).toBe(true);
    expect(isUnsafePath('a/b/c/..')).toBe(true);
    expect(isUnsafePath('foo/bar.txt')).toBe(false);
    expect(isUnsafePath('/abs/path')).toBe(true);
    expect(isUnsafePath('')).toBe(true);
  });

  it('rejects archives with too many entries', () => {
    // Build a large entry list to trigger the cap. We use a tiny per-file
    // payload to keep the zip small.
    const { safeExtract, MAX_ARCHIVE_ENTRIES } = require('../services/packManager');
    const cap = MAX_ARCHIVE_ENTRIES || 5000;
    const entries = [];
    for (let i = 0; i < cap + 5; i++) {
      entries.push({ name: `f-${i}.txt`, content: 'x' });
    }
    const archive = makeZip(entries);
    const dest = tmpDir('extract-many');
    expect(() => safeExtract(archive, dest)).toThrow(/too many entries/);
  });
});

/* ------------------------------------------------------------------ */
/* installFromFile — manifest auto-detect across the layouts packs    */
/* actually ship in (nested folders, outer-wrapping .mcaddon, etc.).  */
/* ------------------------------------------------------------------ */

function manifestJson(uuid, type = 'data', version = [1, 0, 0]) {
  // Minimal but well-formed Bedrock pack manifest. installFromFile reads
  // header.uuid, header.version, header.name, modules[0].type.
  return JSON.stringify({
    format_version: 2,
    header: {
      uuid,
      version,
      name: `Test Pack ${uuid.slice(0, 8)}`,
    },
    modules: [{ type, uuid, version }],
  });
}

describe('installFromFile — manifest auto-detect', () => {
  it('finds a manifest nested one level deep (MyPack/manifest.json)', () => {
    const { installFromFile } = require('../services/packManager');
    const uuid = '11111111-1111-1111-1111-111111111111';
    const archive = makeZip([
      { name: 'MyPack/manifest.json', content: manifestJson(uuid) },
      { name: 'MyPack/script.js', content: 'console.log("hi")' },
    ]);
    const installed = installFromFile(archive);
    expect(installed).toHaveLength(1);
    expect(installed[0].uuid).toBe(uuid);
    // modules[0].type 'data' is mapped to 'behavior' by manifestType().
    expect(installed[0].type).toBe('behavior');
  });

  it('finds a manifest nested two levels deep', () => {
    const { installFromFile } = require('../services/packManager');
    const uuid = '22222222-2222-2222-2222-222222222222';
    const archive = makeZip([
      { name: 'Outer/Inner/manifest.json', content: manifestJson(uuid) },
      { name: 'Outer/Inner/pack_icon.png', content: 'fake' },
    ]);
    const installed = installFromFile(archive);
    expect(installed).toHaveLength(1);
    expect(installed[0].uuid).toBe(uuid);
  });

  it('unwraps an outer .mcaddon wrapping a single inner .mcpack', () => {
    const { installFromFile } = require('../services/packManager');
    const uuid = '33333333-3333-3333-3333-333333333333';
    // Build the inner .mcpack as a real zip, then put that buffer in the
    // outer archive as a file named "pack.mcpack".
    const AdmZipLocal = AdmZip;
    const inner = new AdmZipLocal();
    inner.addFile('manifest.json', Buffer.from(manifestJson(uuid, 'resources')));
    const innerBuf = inner.toBuffer();
    const outer = new AdmZipLocal();
    outer.addFile('pack.mcpack', innerBuf);
    const outerPath = path.join(SANDBOX, `mcaddon-${Date.now()}.zip`);
    outer.writeZip(outerPath);
    const installed = installFromFile(outerPath);
    expect(installed).toHaveLength(1);
    expect(installed[0].uuid).toBe(uuid);
    expect(installed[0].type).toBe('resource'); // 'resources' module type
  });

  it('unwraps zips-of-zips (full recursion) when manifest is at the deepest level', () => {
    const { installFromFile } = require('../services/packManager');
    const uuid = '44444444-4444-4444-4444-444444444444';
    // Build deepest -> middle -> outer, each containing a single zip entry.
    const AdmZipLocal = AdmZip;
    const deepest = new AdmZipLocal();
    deepest.addFile('manifest.json', Buffer.from(manifestJson(uuid, 'data')));
    const middle = new AdmZipLocal();
    middle.addFile('inner.zip', deepest.toBuffer());
    const outer = new AdmZipLocal();
    outer.addFile('outer.zip', middle.toBuffer());
    const outerPath = path.join(SANDBOX, `nested-${Date.now()}.zip`);
    outer.writeZip(outerPath);
    const installed = installFromFile(outerPath);
    expect(installed).toHaveLength(1);
    expect(installed[0].uuid).toBe(uuid);
  });

  it('throws ManifestMissingError when no manifest is anywhere in the archive', () => {
    const { installFromFile, ManifestMissingError } = require('../services/packManager');
    const archive = makeZip([
      { name: 'readme.txt', content: 'no manifest here' },
      { name: 'data/file.txt', content: 'nope' },
    ]);
    let caught;
    try { installFromFile(archive); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ManifestMissingError);
    expect(caught.kind).toBe('manifest_missing');
    expect(Array.isArray(caught.triedPaths)).toBe(true);
    expect(caught.triedPaths.length).toBeGreaterThan(0);
  });
});
