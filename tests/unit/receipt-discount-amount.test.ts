import assert from 'node:assert/strict';
import { ReceiptGenerator } from '../../lib/receipt-generator';

// A fixed-amount discount printed the wrong figure on the paper receipt and
// showed an unreadable percentage in the cart's discount indicator.
//
// Reported case: RecordBook Valiant 150s, price 61.85, qty 1, ₱5.00 off.
// The cart indicator read "Discount: 8.084074373484237%" and the printed
// receipt's totals block read "Discount: -8.08" instead of "-5.00".
//
// Root cause: `item.discount` is a PERCENTAGE everywhere in the POS. The
// discount dialog converts a fixed peso amount into one (5 / 61.85 * 100),
// the cart, the preview (use-receipt.ts), the checkout route and the reprint
// mapper (recent-sales-utils.ts) all treat it as a percentage.
//
// lib/receipt-generator.ts was the one place that read the SAME field as a
// peso amount: it summed the raw percentages for the "Discount:" total and
// for the VAT breakdown fallback's per-line net. With one 8.08% line that
// printed ₱8.08 off against a preview that said ₱5.00 — the mismatch the
// cashier saw. The stale comment on that line ("Recent-sales passes total
// amount") described a mapper that had since been changed to pass a percent,
// so by then NO caller passed pesos.

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');
const gen = new ReceiptGenerator();

// ─── the reported sale ───────────────────────────────────────────────────
const PRICE = 61.85;
const AMOUNT_OFF = 5;
// exactly what use-discount.ts stores for a ₱5.00 fixed-amount discount
const pct = (AMOUNT_OFF / (PRICE * 1)) * 100; // 8.084074373484237

const sale = {
  items: [
    { name: 'RecordBook Valiant 150s', price: PRICE, quantity: 1, discount: pct, taxType: 'VAT' } as any,
  ],
  customer: null,
  totalDue: PRICE - AMOUNT_OFF,
  change: 0,
  paymentMethod: 'CASH',
};

const printed = decode(gen.generateReceipt(sale, null));

// ─── the totals block states the discount in PESOS ───────────────────────
assert.ok(
  printed.includes('-5.00'),
  `the printed discount total is the peso amount actually taken off (5.00), ` +
    `not the percentage rendered as currency (8.08).\n\n${printed}`,
);

assert.ok(
  !printed.includes('-8.08'),
  'the raw percentage is never printed as a peso figure in the totals block',
);

// ─── and it agrees with the preview, which was always right ──────────────
// use-receipt.ts computes price * qty * pct / 100. The paper receipt must
// land on the same number or the cashier sees two different receipts.
const previewTotalDiscount = sale.items.reduce(
  (acc, i: any) => acc + (i.price * i.quantity * (i.discount || 0)) / 100,
  0,
);
assert.equal(
  Number(previewTotalDiscount.toFixed(2)),
  5,
  'the on-screen preview takes ₱5.00 off — the paper receipt must match it',
);

// ─── SUBTOTAL - Discount must equal AMOUNT DUE ───────────────────────────
// The real tell: with the percentage summed as pesos the three printed
// figures did not reconcile, which is also a BIR problem.
const moneyIn = (blob: string, label: string) => {
  // Match the label at the START of its own printed line: 'VAT SALES' also
  // occurs inside 'VAT-EXEMPT SALES', and the encoder prefixes lines with
  // control bytes, so scan line by line and strip non-printables first.
  // Bold lines such as "AMOUNT DUE:" carry ESC/POS emphasis bytes that decode
  // to stray printable characters around the label, so match the label
  // anywhere on the line rather than only at its start, and require the line
  // to END in the figure — which is what keeps 'VAT SALES' from matching the
  // 'VAT-EXEMPT SALES' line.
  const line = blob
    .split(/[\r\n]+/)
    .map((l) => l.replace(/[^\x20-\x7E]/g, '').trim())
    .find((l) => l.includes(label));
  // ...and the same emphasis bytes leave a trailing marker after the figure
  // on bold rows ("EAMOUNT DUE:   56.85E"), so take the LAST figure on the
  // line instead of anchoring to its end.
  const figures = line?.match(/-?[\d,]+\.\d{2}/g);
  const m = figures ? [figures[figures.length - 1]] : null;
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
};
const money = (label: string) => moneyIn(printed, label);
const subtotal = money('SUBTOTAL:');
const discount = money('Discount:');
const due = money('AMOUNT DUE:');
assert.equal(
  Number((subtotal - Math.abs(discount)).toFixed(2)),
  Number(due.toFixed(2)),
  `the receipt must reconcile: SUBTOTAL ${subtotal} - Discount ${Math.abs(discount)} ` +
    `should equal AMOUNT DUE ${due}`,
);

// ─── the VAT breakdown fallback nets the line in pesos too ───────────────
// It used `price * qty - discount`, subtracting a percentage from a peso
// line total, so VAT SALES was understated whenever the receipt had to
// compute its own breakdown.
const vatSales = money('VAT SALES');
assert.equal(
  Number(vatSales.toFixed(2)),
  Number((((PRICE - AMOUNT_OFF) / 1.12)).toFixed(2)),
  'VAT SALES is the discounted line total ex-VAT, netted using the ' +
    'percentage as a percentage',
);

// ─── a 0% line is untouched ──────────────────────────────────────────────
const noDiscount = decode(
  gen.generateReceipt(
    { ...sale, items: [{ ...sale.items[0], discount: 0 }], totalDue: PRICE },
    null,
  ),
);
assert.ok(
  !/Discount:/.test(noDiscount),
  'a sale with no discount prints no discount line at all',
);

// ─── a plain percentage discount still behaves ───────────────────────────
// 10% off 200.00 is 20.00 whichever way the field is read, so this case
// never looked broken; pin it so the fix cannot invert the convention.
const tenPercent = decode(
  gen.generateReceipt(
    {
      ...sale,
      items: [{ name: 'Rice', price: 200, quantity: 1, discount: 10, taxType: 'VAT' } as any],
      totalDue: 180,
    },
    null,
  ),
);
assert.ok(
  tenPercent.includes('-20.00'),
  'a 10% discount on a ₱200 line takes ₱20.00 off',
);

// ─── a fixed-amount discount reads back as the amount entered ────────────
// The cashier typed ₱5.00; the stored percentage is an implementation
// detail, so printing it verbatim ('Disc: 8.084074373484237%') was both
// unreadable and not what was entered. discountType records which kind it
// was, so the annotation is rendered back in those terms.
const asAmount = decode(
  gen.generateReceipt(
    { ...sale, items: [{ ...sale.items[0], discountType: 'amount' }] },
    null,
  ),
);
assert.ok(
  asAmount.includes('Disc: 5.00'),
  'a discount entered as a fixed amount prints as that amount',
);
assert.ok(
  !asAmount.includes('8.084074373484237'),
  'the full-precision stored percentage never reaches the paper',
);

// A percentage discount that does not divide evenly is trimmed, not dumped
// at full float precision.
const awkward = decode(
  gen.generateReceipt(
    {
      ...sale,
      items: [{ name: 'Rice', price: 61.85, quantity: 1, discount: pct, discountType: 'percent' } as any],
    },
    null,
  ),
);
assert.ok(
  awkward.includes('Disc: 8.08%'),
  'a percentage discount is trimmed to two decimals for display',
);

// ─── the per-line indicator still reads as a percentage ──────────────────
assert.ok(
  tenPercent.includes('Disc: 10%'),
  'the per-line discount annotation stays a percentage',
);

console.log('✓ receipt-discount-amount');
