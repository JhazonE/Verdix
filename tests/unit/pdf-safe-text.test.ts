import assert from 'node:assert/strict';
import { pdfSafeText } from '../../lib/report-print';
import { formatCurrency } from '../../lib/utils';

// jsPDF's built-in fonts cover Latin-1 only. A peso sign in a PDF report string
// printed as "±" and letter-spaced the rest of the line, so exportReportPdf runs
// every string through pdfSafeText.

// The peso sign, exactly as formatCurrency emits it, becomes "PHP".
assert.equal(pdfSafeText(formatCurrency(1234.5)), 'PHP 1,234.50');
assert.equal(pdfSafeText(formatCurrency(-50)), '-PHP 50.00');
assert.equal(pdfSafeText('Total Revenue: ₱1,170.00'), 'Total Revenue: PHP 1,170.00');

// Latin-1 letters used in Filipino names must survive untouched.
assert.equal(pdfSafeText('Juan Dela Peña, José'), 'Juan Dela Peña, José');

// Common typography gets plain equivalents.
assert.equal(pdfSafeText('Expires — 3d'), 'Expires - 3d');
assert.equal(pdfSafeText('Ana’s “promo”…'), 'Ana\'s "promo"...');

// Anything else unprintable is one "?", and the output is always Latin-1.
assert.equal(pdfSafeText('日本'), '??');
for (const s of ['₱', '—', '😀', 'ñ']) {
  assert.ok(/^[\x00-\xFF]*$/.test(pdfSafeText(s)), `"${s}" must come out Latin-1`);
}

// Non-strings are written as text, never thrown on.
assert.equal(pdfSafeText(42), '42');
assert.equal(pdfSafeText(null), '');
assert.equal(pdfSafeText(undefined), '');

console.log('✓ pdf-safe-text');
