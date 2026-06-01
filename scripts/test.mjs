/**
 * scripts/test.mjs — fan out `npm test` to backend and frontend sequentially.
 *
 * Lives outside the package.json `scripts` block so we can pass through the
 * exit code and surface which suite failed. The frontend suite spins up
 * jsdom, which is the slower of the two; the backend is a near-instant.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const suites = [
  { name: 'backend', cwd: join(root, 'backend') },
  { name: 'frontend', cwd: join(root, 'frontend') },
];

let failed = 0;
for (const s of suites) {
  console.log(`\n=== ${s.name} ===`);
  const r = spawnSync('npm', ['test'], { cwd: s.cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) { failed += 1; break; }
}

if (failed > 0) {
  console.error('\nTest suite failed.');
  process.exit(1);
}
console.log('\nAll test suites passed.');
