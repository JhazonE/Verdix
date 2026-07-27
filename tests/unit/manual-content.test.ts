import assert from 'node:assert/strict';
import { CHAPTERS } from '../../scripts/manual/content';
import { SCREENS } from '../../scripts/manual/screens';

const allBlocks = CHAPTERS.flatMap((c) => c.sections.flatMap((s) => s.blocks));

// slug is the join key between SCREENS, the PNG filenames, and figure blocks.
// A typo here silently yields a [SCREENSHOT MISSING] box in the built manual.
const knownSlugs = new Set(SCREENS.map((s) => s.slug));
const badRefs = allBlocks
  .filter((b) => b.kind === 'figure')
  .map((b) => (b as { kind: 'figure'; slug: string }).slug)
  .filter((slug) => !knownSlugs.has(slug));
assert.deepEqual(badRefs, [], `content references unknown screen slugs: ${badRefs.join(', ')}`);

assert.deepEqual(CHAPTERS.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'chapters 1-9');

for (const c of CHAPTERS) {
  assert.ok(c.sections.length > 0, `chapter ${c.number} has no sections`);
  for (const s of c.sections) {
    assert.ok(s.blocks.length > 0, `section "${s.heading}" is empty`);
  }
}

const serialized = JSON.stringify(CHAPTERS);
for (const marker of ['TODO', 'TBD', 'Lorem ipsum', 'FIXME']) {
  assert.ok(!serialized.includes(marker), `content still contains "${marker}"`);
}

// Chapter 8 indexes the report pages that get no procedure of their own.
const ch8 = CHAPTERS.find((c) => c.number === 8);
assert.ok(ch8, 'chapter 8 exists');
const reportRows = ch8.sections
  .flatMap((s) => s.blocks)
  .filter((b) => b.kind === 'table')
  .reduce((n, t) => n + (t as { kind: 'table'; rows: string[][] }).rows.length, 0);
assert.ok(reportRows >= 23, `report index lists ${reportRows} reports, expected at least 23`);

console.log('manual-content: all assertions passed');
