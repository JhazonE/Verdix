import assert from 'node:assert/strict';
import { ExchangeSlipGenerator } from '../../lib/exchange-slip-generator';

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const gen = new ExchangeSlipGenerator();

// ─── both SI and MC numbers print, plus a payment-collected balance line ──
const upsell = decode(gen.generate({
  mcNumber: 'MC-000123',
  siNumber: '000456',
  date: new Date('2026-09-24T10:00:00Z').toISOString(),
  cashierName: 'Juan Dela Cruz',
  customerName: 'Walk-in Customer',
  returnedItem: { name: 'Old Widget', quantity: 1, price: 50, total: 50 },
  newItem: { name: 'New Widget', quantity: 1, price: 65, total: 65 },
  balance: 15,
  businessSettings: { businessName: 'Verdix Store', address: '123 Main St' } as any,
}));

assert.ok(upsell.includes('MC NO.: MC-000123'), 'prints the MC number');
assert.ok(upsell.includes('SI NO.:'), 'prints an SI NO. line when siNumber is present');
assert.ok(upsell.includes('Old Widget'), 'prints the returned item name');
assert.ok(upsell.includes('New Widget'), 'prints the new item name');
assert.ok(upsell.includes('PAYMENT COLLECTED'), 'labels a positive balance as collected, not credited');
assert.ok(upsell.includes('15.00'), 'prints the balance amount');

// ─── even exchange omits the balance line and its label entirely ─────────
const even = decode(gen.generate({
  mcNumber: 'MC-000124',
  siNumber: '000457',
  date: new Date().toISOString(),
  cashierName: 'Juan',
  customerName: 'Walk-in Customer',
  returnedItem: { name: 'Old Widget', quantity: 1, price: 50, total: 50 },
  newItem: { name: 'New Widget', quantity: 1, price: 50, total: 50 },
  balance: 0,
  businessSettings: null,
}));

assert.ok(!even.includes('PAYMENT COLLECTED'), 'even exchange has no payment-collected line');
assert.ok(!even.includes('CREDIT TO ACCOUNT'), 'even exchange has no credit-to-account line');

// ─── downsell labels the balance as a credit, not a collection ───────────
const downsell = decode(gen.generate({
  mcNumber: 'MC-000125',
  siNumber: '000458',
  date: new Date().toISOString(),
  cashierName: 'Juan',
  customerName: 'Maria Santos',
  returnedItem: { name: 'Expensive Widget', quantity: 1, price: 80, total: 80 },
  newItem: { name: 'Cheap Widget', quantity: 1, price: 60, total: 60 },
  balance: -20,
  businessSettings: null,
}));

assert.ok(downsell.includes('CREDIT TO ACCOUNT'), 'labels a negative balance as credited, not collected');
assert.ok(!downsell.includes('PAYMENT COLLECTED'));

console.log('✓ exchange-slip-generator');
