import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildManual } from '../../scripts/manual/build-docx';

const OUT = path.join(process.cwd(), 'tests', 'unit', '.tmp-manual.docx');

void (async () => {
  rmSync(OUT, { force: true });
  const result = await buildManual(OUT);

  assert.ok(existsSync(OUT), 'no .docx was written');

  const buf = readFileSync(OUT);
  // A .docx is a zip container; it must start with the PK local-file header.
  assert.equal(buf.subarray(0, 2).toString('ascii'), 'PK', 'output is not a zip container');
  assert.ok(buf.length > 20_000, `document is implausibly small (${buf.length} bytes)`);

  // A missing PNG must degrade to a placeholder, never throw.
  assert.ok(Array.isArray(result.missing), 'missing[] not reported');
  assert.ok(result.figures > 0, 'no figures were embedded');

  rmSync(OUT, { force: true });
  console.log('manual-build: all assertions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
