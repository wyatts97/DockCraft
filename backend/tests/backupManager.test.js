/**
 * tests/backupManager.test.js — backup path validation.
 *
 * Covers backupPath's defenses: path traversal and basename enforcement.
 * The actual zip/unzip is exercised in routes/worlds.test.js; here we just
 * verify the path-resolver contract.
 */

const path = require('node:path');

const { clearSandbox, DATA_PATH } = require('./helpers');

beforeEach(() => {
  for (const key of Object.keys(require.cache)) {
    if (key.replace(/\\/g, '/').match(/(services[\/]backupManager|config\.js$)/)) {
      delete require.cache[key];
    }
  }
  clearSandbox();
});

describe('backupPath', () => {
  const { backupPath } = require('../services/backupManager');

  it('returns a path inside backupsDir for a clean filename', () => {
    const p = backupPath('2026-06-01-120000-world.zip');
    expect(p.startsWith(DATA_PATH)).toBe(true);
    expect(p.endsWith('2026-06-01-120000-world.zip')).toBe(true);
  });

  it('strips directory components from a traversal filename', () => {
    const p = backupPath('../../../etc/passwd');
    expect(p.startsWith(DATA_PATH)).toBe(true);
    expect(p).not.toContain('..');
    expect(p.endsWith('passwd')).toBe(true);
  });

  it('strips an absolute path down to its basename', () => {
    const p = backupPath('/etc/passwd');
    expect(p.startsWith(DATA_PATH)).toBe(true);
    expect(p).not.toContain('/etc/');
    expect(p.endsWith('passwd')).toBe(true);
  });

  it('rejects a filename that resolves outside the backups dir', () => {
    // After basename(), the name is ".." alone, which resolves to the parent
    // of backupsDir. The check catches that.
    expect(() => backupPath('..')).toThrow(/escapes|outside/);
  });

  it('accepts filenames with subdirectory-like characters after basename', () => {
    // On POSIX path.basename('a/b/c.zip') returns 'c.zip'. The dot is
    // preserved. Make sure the resolver doesn't reject legitimate names.
    const p = backupPath('my.world.v2.zip');
    expect(p.endsWith('my.world.v2.zip')).toBe(true);
  });
});
