/**
 * Tender rules for the POS exchange flow (/api/sales/exchanges and
 * ExchangeBalanceView). Pure, so it is shared by the client view and the
 * server route and the two can never disagree.
 */

/**
 * payment_details.payment_method for the part of an exchange's sale leg that
 * the returned item's value pays for. No new money reaches the drawer for that
 * part, so it must NOT be counted as cash or card. Every cash reconciler
 * (x-reading, z-reading, shifts) recognises cash only by
 * `payment_method.toUpperCase() === 'CASH'`, so this string is listed as its
 * own non-cash line and never inflates cashSales / cashInDrawer / expectedCash.
 */
export const EXCHANGE_CREDIT_TENDER = 'EXCHANGE CREDIT';

/**
 * The spec limits an exchange's balance settlement to cash or card only.
 *
 * payment_methods has no tender-type column (only name, is_active,
 * require_reference, points_amount, currency_equivalent), and the rest of the
 * POS already identifies tender kinds by name (use-tender.ts: 'CASH',
 * 'CHARGE', 'POINTS'; payment-validation: 'CASH', 'CREDIT_CARD',
 * 'GIFT_CHECK'). This follows the same convention: cash is the name 'CASH',
 * a card is any name containing 'CARD' ("Credit Card", "Debit Card",
 * "CREDIT_CARD") except gift cards, which are stored value like gift checks.
 * POINTS, CHARGE, GCash, Bank Transfer, Check, etc. are all rejected.
 */
export function isExchangeBalanceTender(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().toUpperCase();
  if (!n) return false;
  if (n === 'CASH') return true;
  return n.includes('CARD') && !n.includes('GIFT');
}
