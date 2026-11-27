/**
 * Makes a sale's line rows add up to its header total, to the centavo.
 *
 * Why this exists: the cart total is the UNROUNDED line nets summed, then
 * rounded once when it lands in sales_transactions.total /
 * pos_transactions.total_amount (DECIMAL(10,2)). Each line row was written
 * unrounded too, so MySQL rounded every line on its own. Σ(round(line)) is not
 * round(Σ line), so any sale with a discount — Senior/PWD 20% on ₱12.99, or a
 * fixed ₱ discount that the cart stores as a percentage like 8.0840743…% —
 * left the line-level reports (By Tax Type, BIR Summary, By Product, …) a
 * centavo or two away from Sales by Date and the Z-reading.
 *
 * The header is what the customer was shown and paid, so it is never changed
 * here. Each line is rounded normally, and the few centavos of rounding
 * remainder are then moved onto the lines whose rounding was furthest off
 * (largest-remainder method). No line moves more than one centavo from its
 * exact value.
 *
 * Pure and dependency-free so it can be unit tested and shared by every
 * writer of line rows.
 */

/**
 * Centavos MySQL will store for a JS number written to a DECIMAL(…,2) column.
 *
 * mysql2 sends a number as String(n) and MySQL rounds that exact decimal half
 * away from zero — so 9.045 (binary 9.04499…) is stored as 9.05, which
 * Math.round(9.045 * 100) gets wrong. Mirroring the column keeps the target
 * total here identical to the stored header.
 */
export function toCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(10);
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '000').slice(0, 3);
  let cents = Number(intPart) * 100 + Number(frac.slice(0, 2));
  if (frac[2] >= '5') cents += 1;
  return neg && cents !== 0 ? -cents : cents;
}

export interface AllocationLine {
  price: number;
  quantity: number;
  /** Line discount as a percentage — the cart stores even ₱ discounts this way. */
  discountPercent: number;
}

export interface AllocatedLine {
  /** Net amount for the line, in pesos, exactly two decimals. */
  lineTotal: number;
  /** Gross (price × quantity) minus lineTotal, in pesos. */
  discountAmount: number;
}

/**
 * @param lines  cart lines in order
 * @param headerTotal  the sale total as the checkout computed it (unrounded is fine)
 */
export function allocateLineTotals(lines: AllocationLine[], headerTotal: number): AllocatedLine[] {
  const rows = lines.map((l, index) => {
    const gross = Number(l.price) * Number(l.quantity);
    const pct = Number(l.discountPercent) || 0;
    const exact = gross - (gross * pct) / 100;
    const cents = toCents(exact);
    // toFixed(6) absorbs binary noise so two lines that are both exactly half
    // a centavo off compare as a tie (and the tie then goes by index).
    const residual = Number((Number((exact * 100).toFixed(6)) - cents).toFixed(6));
    return { index, grossCents: toCents(gross), cents, residual };
  });

  const target = toCents(headerTotal);
  let diff = target - rows.reduce((a, r) => a + r.cents, 0);

  // Each line's rounding is off by at most half a centavo, so a genuine
  // remainder can never exceed one centavo per line. A larger gap means the
  // header was not computed from these lines (a stale client total, points,
  // a caller-specific adjustment); forcing it onto the lines would invent
  // discounts, so keep plain per-line rounding.
  if (diff !== 0 && Math.abs(diff) <= rows.length) {
    if (diff > 0) {
      const order = [...rows].sort((a, b) => b.residual - a.residual || a.index - b.index);
      for (const r of order) {
        if (diff === 0) break;
        if (r.cents < r.grossCents) { r.cents += 1; diff -= 1; }
      }
    } else {
      const order = [...rows].sort((a, b) => a.residual - b.residual || a.index - b.index);
      for (const r of order) {
        if (diff === 0) break;
        if (r.cents > 0) { r.cents -= 1; diff += 1; }
      }
    }
  }

  return rows.map(r => ({
    lineTotal: r.cents / 100,
    discountAmount: (r.grossCents - r.cents) / 100,
  }));
}
