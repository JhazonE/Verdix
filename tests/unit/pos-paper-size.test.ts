// The terminal's own paper size (localStorage 'pos_paper_size', set in POS
// Connection Settings) must win over the DB default. Readings used to read the
// DB value only, so a till set to 80mm still printed them at 58mm.
import assert from 'node:assert/strict';
import { resolvePaperSize, withTerminalPaperSize } from '../../lib/pos-paper-size';

const store: Record<string, string> = {};
(globalThis as any).window = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
};

// No terminal override: the DB value stands.
assert.equal(resolvePaperSize('80mm'), '80mm');
assert.equal(resolvePaperSize('58mm'), '58mm');
assert.equal(resolvePaperSize(undefined), '58mm');

// Terminal set to 80mm beats a DB default of 58mm (the reported bug).
store.pos_paper_size = '80mm';
assert.equal(resolvePaperSize('58mm'), '80mm');
assert.equal(withTerminalPaperSize({ businessName: 'X', paperSize: '58mm' }).paperSize, '80mm');
assert.equal(withTerminalPaperSize({ businessName: 'X' }).businessName, 'X');

// And the other way round.
store.pos_paper_size = '58mm';
assert.equal(resolvePaperSize('80mm'), '58mm');

console.log('✓ pos-paper-size: terminal setting overrides DB default');
