/**
 * Decides whether a Charge-to-Account sale is allowed against a customer's
 * credit limit.
 *
 * `customers.credit_limit` was stored, imported, exported and displayed (the
 * POS customer-account dialog shows it beside the account credit) but NOTHING
 * enforced it: a grep of every reader found display, import/export and
 * repository mapping only. A customer could charge indefinitely past their
 * limit with no warning.
 *
 * **Zero means UNLIMITED here, not "no credit allowed".** That is a
 * deliberate decision, not an oversight: every customer in the live database
 * currently has `credit_limit = 0`, so reading 0 strictly would have blocked
 * every charge sale in the store the moment enforcement shipped. The limit
 * starts applying the moment someone sets a real figure. NULL is treated the
 * same way.
 *
 * The check is advisory to the caller: this module returns a decision, and the
 * checkout route refuses the sale unless a supervisor override is supplied.
 */

/** Money is only ever whole centavos. */
function centavos(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export interface CreditLimitCheck {
  /** The customer's configured ceiling. 0 or NULL means unlimited. */
  creditLimit: number | string | null | undefined;
  /** What the customer already owes on unpaid invoices. */
  currentBalance: number | string | null | undefined;
  /** The charge being attempted now. */
  chargeAmount: number | string | null | undefined;
  /** Account credit that will be applied to this charge, reducing its impact. */
  creditApplied?: number | string | null;
}

export interface CreditLimitDecision {
  /** False only when a real limit exists and this charge would breach it. */
  allowed: boolean;
  /** True when no limit is configured, so no ceiling was applied. */
  unlimited: boolean;
  limit: number;
  /** Balance after this charge, net of any account credit applied. */
  projectedBalance: number;
  /** How far past the limit the projected balance lands. 0 when within. */
  exceededBy: number;
  /** Headroom left under the limit. 0 when unlimited or already breached. */
  remainingCredit: number;
}

/**
 * Evaluates a charge against the customer's limit.
 *
 * The charge counts net of any account credit being applied to it, because
 * credit the customer has already paid in is not new exposure — the checkout
 * route applies that credit to the same invoice in the same transaction.
 */
export function checkCreditLimit(input: CreditLimitCheck): CreditLimitDecision {
  const limit = centavos(Number(input.creditLimit ?? 0) || 0);
  const balance = centavos(Number(input.currentBalance ?? 0) || 0);
  const charge = centavos(Number(input.chargeAmount ?? 0) || 0);
  const credit = centavos(Number(input.creditApplied ?? 0) || 0);

  // Credit cannot offset more than the charge itself.
  const netCharge = centavos(Math.max(0, charge - Math.min(credit, charge)));
  const projectedBalance = centavos(balance + netCharge);

  // A limit of 0 (or NULL, or a negative value from a bad import) is no limit.
  if (limit <= 0) {
    return {
      allowed: true,
      unlimited: true,
      limit: 0,
      projectedBalance,
      exceededBy: 0,
      remainingCredit: 0,
    };
  }

  const exceededBy = centavos(Math.max(0, projectedBalance - limit));

  return {
    allowed: exceededBy <= 0,
    unlimited: false,
    limit,
    projectedBalance,
    exceededBy,
    remainingCredit: centavos(Math.max(0, limit - balance)),
  };
}

/**
 * The message shown to the cashier when a charge is refused. Names the three
 * figures the decision rests on, so the cashier can explain it at the till
 * without opening the back office.
 */
export function creditLimitMessage(
  decision: CreditLimitDecision,
  customerName?: string | null,
): string {
  const peso = (n: number) =>
    `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const who = customerName ? `${customerName}'s` : 'The';
  return (
    `${who} credit limit of ${peso(decision.limit)} would be exceeded by ` +
    `${peso(decision.exceededBy)}. This charge brings the balance to ` +
    `${peso(decision.projectedBalance)}. A supervisor can approve it.`
  );
}
