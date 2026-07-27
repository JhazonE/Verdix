import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SCREENS, routeToPageFile } from '../../scripts/manual/screens';

// A screen pointing at a deleted or renamed page would silently produce a
// blank screenshot, so fail loudly here instead.
const root = process.cwd();
const missingPages = SCREENS
  .map((s) => ({ slug: s.slug, file: routeToPageFile(s.route) }))
  .filter(({ file }) => !existsSync(path.join(root, file)));
assert.deepEqual(missingPages, [], `screens point at non-existent pages: ${JSON.stringify(missingPages)}`);

const slugs = SCREENS.map((s) => s.slug);
assert.equal(new Set(slugs).size, slugs.length, 'duplicate screen slugs');

// Callouts must read 1..n in order, because the manual's numbered steps
// are keyed to these badge numbers.
for (const s of SCREENS) {
  if (!s.callouts?.length) continue;
  const ns = s.callouts.map((c) => c.n);
  assert.deepEqual(ns, ns.map((_, i) => i + 1), `callouts on ${s.slug} must be 1..n in order`);
}

for (const s of SCREENS) {
  for (const c of s.callouts ?? []) {
    const positioned = Boolean(c.selector) || (typeof c.x === 'number' && typeof c.y === 'number');
    assert.ok(positioned, `callout ${c.n} on ${s.slug} needs a selector or x/y`);
  }
}

console.log('manual-screens: all assertions passed');
