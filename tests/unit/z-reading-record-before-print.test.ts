import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// A Z-reading must be RECORDED even when it cannot be PRINTED.
//
// Root cause: handlePrintAndFinalize printed first and saved second, both
// inside one try block:
//
//     try {
//       ...connect(); if (!success) throw new Error('Could not connect');
//       await print(bytes);                 // <-- any failure here throws
//       if (data.id === 'PREVIEW') {
//         await fetch('/sales/z-reading', { method: 'POST', ... });  // never runs
//       }
//     } catch (error) { toast('Failed to finalize Z-Reading'); }
//
// So an offline printer, a failed connect(), a throwing print(), or a
// not-ready browser print engine all jumped straight to catch and the POST
// never fired. The shift's Z-reading was never written.
//
// That is a BIR problem, not a cosmetic one: a Z-reading is a required tax
// record and daily totals reset against it. A paper jam silently losing the
// day's filed record is worse than a Z-reading with no receipt — the receipt
// can be reprinted from a saved record, but nothing can reconstruct a record
// that was never written.
//
// The fix inverts the order: persist first, then print, and report a print
// failure WITHOUT discarding the saved record.
//
// Asserted on source text because the ordering lives in a React event
// handler over fetch + a printer bridge, which the unit suite cannot execute
// (no DB, no printer, no DOM). Same approach as x-reading-void-source.test.ts.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

const dialog = stripComments(read('app/(app)/pos/z-reading-report/ZReadingDialog.tsx'));

// Scope to the handler. Take everything from its declaration to the start of
// the next top-level declaration rather than brace-matching — a non-greedy
// block regex truncates at the first nested close brace and would pass on
// code it never actually read.
const handlerStart = dialog.indexOf('const handlePrintAndFinalize');
assert.ok(handlerStart !== -1, 'handlePrintAndFinalize still exists');

const after = dialog.slice(handlerStart);
const nextDecl = after.slice(1).search(/\n\s*(?:if \(isLoading\)|return \(|function |export )/);
const handler = nextDecl === -1 ? after : after.slice(0, nextDecl + 1);

const savePos = handler.search(/fetch\(\s*getApiUrl\(\s*['"`]\/sales\/z-reading/);
assert.ok(savePos !== -1, 'the handler still POSTs the Z-reading to /sales/z-reading');

// ─── the record is written BEFORE anything is sent to a printer ──────────
const printCalls = [
  /await\s+print\(/,
  /handleReactToPrint\(\)/,
  /await\s+connect\(\)/,
];

for (const pattern of printCalls) {
  const m = handler.match(pattern);
  if (!m || m.index === undefined) continue;
  assert.ok(
    savePos < m.index,
    `the Z-reading is persisted before \`${m[0].trim()}\` runs, so a printer ` +
      'failure can never prevent the record from being written',
  );
}

// ─── a print failure must not be raised as a finalize failure ────────────
// Printing has to be caught on its own. If it still shares one try with the
// save, a print throw aborts the handler before the POST — the original bug.
const printSection = handler.slice(savePos);
assert.ok(
  /catch/.test(printSection),
  'printing is wrapped in its own catch AFTER the save, so a print error is ' +
    'reported as a print error rather than aborting the finalize',
);

assert.ok(
  !/throw new Error\(\s*['"`]Could not connect to printer/.test(
    handler.slice(0, savePos),
  ),
  'a printer connection failure before the save no longer throws out of the ' +
    'handler and skip the POST',
);

// ─── the operator must be told the difference ────────────────────────────
// "Saved but not printed" and "not saved" demand different actions: reprint
// versus re-run the Z-reading. Reporting both as "Failed to finalize" is what
// hid this bug.
assert.ok(
  /saved|recorded/i.test(printSection) && /print/i.test(printSection),
  'when printing fails after a successful save, the toast says the reading ' +
    'WAS recorded and only the printing failed, so staff reprint instead of ' +
    'believing the Z-reading never happened',
);

// ─── the standalone /pos/z-reading page must record too ──────────────────
// This page rendered <ZReadingReportView /> with no onPrint at all, while the
// view's own handler toasted "Z-Reading Finalized — daily totals have been
// reset". It printed and claimed success while persisting nothing.
const page = stripComments(read('app/(app)/pos/z-reading/page.tsx'));
const view = stripComments(read('app/(app)/pos/z-reading/ZReadingReportView.tsx'));

const viewPersists = /fetch\(\s*getApiUrl\(\s*['"`]\/sales\/z-reading[\s\S]{0,400}?method:\s*['"]POST['"]/.test(
  view,
);
const pageWiresCallback = /<ZReadingReportView[^>]*onPrint=/.test(page);

assert.ok(
  viewPersists || pageWiresCallback,
  'the /pos/z-reading page either persists the reading itself or is wired to ' +
    'a handler that does — it must not announce "Z-Reading Finalized" and ' +
    '"daily totals have been reset" while recording nothing',
);

// And whichever way it records, it must still do so independently of the print.
if (viewPersists) {
  const viewHandlerStart = view.indexOf('const handlePrint');
  const viewHandler = view.slice(viewHandlerStart);
  const viewSave = viewHandler.search(/fetch\(\s*getApiUrl\(\s*['"`]\/sales\/z-reading/);
  const viewPrint = viewHandler.search(/window\.print\(\)|await\s+print\(/);
  if (viewSave !== -1 && viewPrint !== -1) {
    assert.ok(
      viewSave < viewPrint,
      'the standalone view also persists before printing',
    );
  }
}

console.log('✓ z-reading-record-before-print');
