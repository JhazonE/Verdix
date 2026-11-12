import assert from 'node:assert/strict';
import { resolveVatStatus } from '../../lib/import/vat-status';

const rates = [
  { name: 'YES (Subject to 12% VAT)', isDefault: true },
  { name: 'NO (Non-VAT)' },
  { name: 'VAT Exempt' },
  { name: 'Zero Rated' },
];

const ok = (raw: unknown) => {
  const r = resolveVatStatus(raw, rates);
  assert.ok(r.ok, `expected "${raw}" to resolve`);
  return (r as { ok: true; name: string }).name;
};

// Exact tax-rate name, ignoring case and spacing.
assert.equal(ok('yes (subject to 12% vat)'), 'YES (Subject to 12% VAT)');
assert.equal(ok('  VAT   exempt '), 'VAT Exempt');

// Short spellings land on the rate of the same BIR type.
assert.equal(ok('VAT'), 'YES (Subject to 12% VAT)');
assert.equal(ok('vatable'), 'YES (Subject to 12% VAT)');
assert.equal(ok('Non-VAT'), 'NO (Non-VAT)');
assert.equal(ok('exempt'), 'VAT Exempt');
assert.equal(ok('zero-rated'), 'Zero Rated');

// A typo must be rejected, not silently treated as VATable.
const typo = resolveVatStatus('Vaat', rates);
assert.equal(typo.ok, false);
assert.match((typo as { ok: false; reason: string }).reason, /Unknown VAT status "Vaat"/);

// An alias with no matching configured rate is rejected too.
assert.equal(resolveVatStatus('exempt', [{ name: 'YES (Subject to 12% VAT)' }]).ok, false);

// Empty is the caller's "leave alone" case and never reaches here, but must not resolve.
assert.equal(resolveVatStatus('', rates).ok, false);

console.log('import-vat-status: all assertions passed');
