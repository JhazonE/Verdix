// X/Z-reading thermal output must follow the POS "Paper Size" setting:
// 58mm = 32 chars per line, 80mm = 48. Both generators used to hardcode 32,
// so an 80mm printer printed a narrow strip regardless of the setting.
import assert from 'node:assert/strict';
import { XReadingGenerator } from '../../lib/x-reading-generator';
import { ZReadingGenerator } from '../../lib/z-reading-generator';

const decode = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const longestDash = (s: string) => Math.max(...(s.match(/-+/g) || ['']).map(m => m.length));

const xData: any = {
  reportDate: new Date('2026-11-16T10:00:00'),
  paymentMethods: [{ name: 'CASH', amount: 100 }],
  cashierName: 'Ana', shiftStart: new Date('2026-11-16T08:00:00'), shiftEnd: null,
  startingCash: 0, cashInDrawer: 100, cashDenominations: [],
};
const zData: any = { reportDate: new Date('2026-11-16T22:00:00'), paymentMethods: [{ name: 'CASH', amount: 100 }] };

const x58 = decode(new XReadingGenerator().generate(xData));
const x80 = decode(new XReadingGenerator().generate(xData, '80mm'));
assert.equal(longestDash(x58), 32, 'X-reading 58mm should be 32 wide');
assert.equal(longestDash(x80), 48, 'X-reading 80mm should be 48 wide');

const z58 = decode(new ZReadingGenerator().generate(zData, { paperSize: '58mm' }));
const z80 = decode(new ZReadingGenerator().generate(zData, { paperSize: '80mm' }));
assert.equal(longestDash(z58), 32, 'Z-reading 58mm should be 32 wide');
assert.equal(longestDash(z80), 48, 'Z-reading 80mm should be 48 wide');

// One generator instance reused across widths must not leak the earlier width.
const gen = new XReadingGenerator();
gen.generate(xData, '80mm');
assert.equal(longestDash(decode(gen.generate(xData))), 32, 'width must not leak between calls');

console.log('✓ reading-paper-width: X/Z readings follow paper size');
