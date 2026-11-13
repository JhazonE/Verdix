import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isImmediatePaymentMethod, resolveInitialSettlement } from '../../lib/invoice-payment';

// A back-office invoice paid with Cash / GCash / PayPal is paid on the spot, so
// it must be created Paid with amount_paid = total. Charge is credit: Pending.
// Before this, only the due date followed the method; the status stayed Pending
// with nothing paid, so a cash invoice read as owed and, after its due day,
// "Over Due".

for (const m of ['Cash', 'cash', ' CASH ', 'GCash', 'Gcash', 'PayPal', 'paypal']) {
  assert.equal(isImmediatePaymentMethod(m), true, `${m} is paid on the spot`);
}
for (const m of ['Charge', 'charge', 'Check', 'Bank Transfer', '', null, undefined]) {
  assert.equal(isImmediatePaymentMethod(m as any), false, `${String(m)} is not`);
}

// Paid on the spot: Paid, fully settled.
assert.deepEqual(resolveInitialSettlement('Cash', 145, undefined), { status: 'Paid', amountPaid: 145, paidNow: true });
assert.deepEqual(resolveInitialSettlement('GCash', 99.5, 'Pending'), { status: 'Paid', amountPaid: 99.5, paidNow: true });

// Credit stays unpaid.
assert.deepEqual(resolveInitialSettlement('Charge', 145, undefined), { status: 'Pending', amountPaid: 0, paidNow: false });

// An explicit non-default status is respected, never overridden by the method.
assert.deepEqual(resolveInitialSettlement('Cash', 145, 'To Deliver'), { status: 'To Deliver', amountPaid: 0, paidNow: false });

// The server decides, not the form: the use case applies it and records the payment.
const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8').replace(/\r\n/g, '\n');
const useCase = read('src/core/sales/application/CreateSaleUseCase.ts');
assert.ok(useCase.includes('resolveInitialSettlement('), 'use case must apply the settlement rule');
assert.ok(/INSERT INTO customer_payments/.test(useCase) && /INSERT INTO payment_allocations/.test(useCase),
  'a paid-on-issue invoice must record the payment AND its allocation');
assert.ok(/amount_paid/.test(read('src/infrastructure/repositories/MySqlSaleRepository.ts')),
  'the repository must persist amount_paid');
// The client-safe module must never pull in the database (it is imported by the form).
assert.ok(!/lib\/mysql/.test(read('lib/invoice-payment.ts')), 'lib/invoice-payment.ts must stay client-safe');

console.log('✓ invoice-settlement');
