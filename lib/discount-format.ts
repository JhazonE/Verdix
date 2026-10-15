/**
 * How a line's discount is written for a human to read.
 *
 * A discount is STORED as a percentage everywhere in the POS — the discount
 * dialog converts a fixed peso amount into one at entry (₱5.00 off a ₱61.85
 * line becomes 8.084074373484237%) and only that percentage reaches the cart,
 * the receipt and the database.
 *
 * That conversion is lossy for display purposes: printing the stored number
 * verbatim gave a cashier "Discount: 8.084074373484237%" for what they had
 * typed as ₱5.00. `discountType` still records which kind was entered, so a
 * fixed amount is rendered back as the amount it took off, and every other
 * kind is rendered as a percentage trimmed to at most two decimals.
 *
 * Shared by the cart line, the on-screen receipt preview and the printed
 * receipt so all three agree on the wording.
 */

export interface DiscountedLine {
  price: number;
  quantity: number;
  discount?: number;
  discountType?: string;
}

/** The peso value a line's discount takes off. The percentage is the source of truth. */
export function lineDiscountAmount(item: DiscountedLine): number {
  return (item.price * item.quantity * (item.discount || 0)) / 100;
}

/**
 * The percentage, trimmed for display: at most two decimals and no trailing
 * zeroes, so 10 stays "10" and 8.084074373484237 becomes "8.08".
 */
export function formatDiscountPercent(percent: number): string {
  return String(Number(percent.toFixed(2)));
}

/**
 * The discount annotation shown beside a line, e.g. "Disc: 10%" or, for a
 * discount entered as a fixed amount, "Disc: 5.00".
 *
 * `currency` prefixes the amount form — the cart uses "₱", the ESC/POS
 * receipt passes nothing because the printer's codepage has no peso glyph.
 */
export function formatLineDiscount(item: DiscountedLine, currency = ''): string {
  if (item.discountType === 'amount') {
    return `${currency}${lineDiscountAmount(item).toFixed(2)}`;
  }
  return `${formatDiscountPercent(item.discount || 0)}%`;
}
