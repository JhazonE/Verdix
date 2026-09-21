import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildHtml, buildManualPdf } from '../../scripts/manual/build-pdf';

const OUT = path.join(process.cwd(), 'tests', 'unit', '.tmp-manual.pdf');

void (async () => {
  // ── HTML stage: assert on the markup, which is cheap and does not need a
  // browser. The PDF stage below covers that the markup actually renders.
  const state = { figureN: 0, missing: [] as string[] };
  const html = buildHtml(state);

  assert.ok(html.includes('<!doctype html>'), 'no doctype emitted');
  assert.ok(html.includes('Table of Contents'), 'TOC section missing');
  assert.ok(state.figureN > 0, 'no figures rendered into the HTML');

  // Every chapter must reach the output, or a silent content regression could
  // ship a manual missing whole sections.
  const { CHAPTERS } = await import('../../scripts/manual/content');
  for (const chapter of CHAPTERS) {
    assert.ok(
      html.includes(`Chapter ${chapter.number}:`),
      `chapter ${chapter.number} missing from HTML`,
    );
  }

  // Content is interpolated into HTML, so an unescaped angle bracket or
  // ampersand from content.ts would corrupt the markup.
  assert.ok(!/<script/i.test(html), 'unescaped <script> reached the document');

  // The "Tip:"/"Warning:" prefix in content.ts must not be doubled up by the
  // renderer's own label.
  assert.ok(!/note-label">Tip:<\/span>\s*Tip:/i.test(html), 'duplicated "Tip:" label');
  assert.ok(!/note-label">Warning:<\/span>\s*Warning:/i.test(html), 'duplicated "Warning:" label');

  // ── PDF stage.
  rmSync(OUT, { force: true });
  const result = await buildManualPdf(OUT);

  assert.ok(existsSync(OUT), 'no .pdf was written');

  const buf = readFileSync(OUT);
  assert.equal(buf.subarray(0, 4).toString('ascii'), '%PDF', 'output is not a PDF');
  assert.ok(buf.length > 20_000, `document is implausibly small (${buf.length} bytes)`);

  // A missing PNG must degrade to a placeholder, never throw.
  assert.ok(Array.isArray(result.missing), 'missing[] not reported');
  assert.ok(result.figures > 0, 'no figures were embedded');

  rmSync(OUT, { force: true });
  console.log('manual-pdf: all assertions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
