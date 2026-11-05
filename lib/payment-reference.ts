/**
 * Allocates the next auto-generated customer-payment reference.
 *
 * `customer_payments.reference` carries a UNIQUE index, and both writers
 * (app/api/customer-payments and app/api/customers/invoices/[id]/payment)
 * derived the next value with
 *
 *     SELECT MAX(CAST(reference AS UNSIGNED)) ... ; nextRef = max + 1
 *
 * which races. Verified on this database: the transaction isolation level is
 * REPEATABLE-READ, where a bare aggregate takes no lock that would stop a
 * second transaction reading the same MAX. Two cashiers recording a payment at
 * the same moment therefore computed the SAME reference, and the UNIQUE index
 * turned the loser into an ER_DUP_ENTRY that failed the whole payment — the
 * customer had handed over money and the system recorded nothing. This project
 * deploys one server per terminal against a shared database, so concurrent
 * writers are the normal case, not an edge case.
 *
 * Fixed by retrying on duplicate-key instead of trying to make the read
 * atomic. That is sound HERE specifically because a payment reference is an
 * operational receipt number, NOT a BIR sequential document number: a gap in
 * it carries no legal meaning. Do NOT copy this approach to
 * `sales_invoice_number`, where gaps and duplicates are both prohibited.
 */

/** mysql2 surfaces a unique-index violation under this code. */
function isDuplicateKey(error: any): boolean {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

export const PAYMENT_REFERENCE_ATTEMPTS = 6;

/**
 * Inserts a payment row, generating its reference if the caller supplied none.
 *
 * `insert` is called with the reference to use and must perform the INSERT on
 * the caller's transaction; it may throw a duplicate-key error, which is the
 * signal to try the next number. The reference actually written is returned.
 *
 * A caller-supplied reference is never retried — if the user typed a reference
 * that already exists, silently writing a different one would file the payment
 * under a number that does not match the paper receipt in the customer's hand.
 * That case throws so the UI can ask the user to resolve it.
 */
export async function nextPaymentReference(
  connection: {
    query: (sql: string, values?: any[]) => Promise<any>;
  },
  suppliedReference: string | null | undefined,
  insert: (reference: string) => Promise<void>,
): Promise<string> {
  if (suppliedReference) {
    const [existing]: any = await connection.query(
      'SELECT id FROM customer_payments WHERE reference = ?',
      [suppliedReference],
    );
    if (existing && existing.length > 0) {
      throw new Error('Reference already exists');
    }
    await insert(suppliedReference);
    return suppliedReference;
  }

  let lastError: any = null;
  let lastTried = 0;

  for (let attempt = 0; attempt < PAYMENT_REFERENCE_ATTEMPTS; attempt++) {
    // Re-read the maximum on every attempt: a competing transaction has
    // committed since the last try, so its reference is now visible and the
    // next candidate must clear it.
    const [maxRow]: any = await connection.query(
      "SELECT MAX(CAST(reference AS UNSIGNED)) AS max_ref FROM customer_payments WHERE reference REGEXP '^[0-9]+$'",
    );

    const highest =
      maxRow && maxRow.length > 0 && maxRow[0].max_ref !== null
        ? parseInt(maxRow[0].max_ref, 10)
        : 0;

    // Normally just the next number up. But if the re-read maximum has NOT
    // moved past what we last tried — which happens when the competitor's row
    // is not visible to this transaction's snapshot, the usual case under
    // REPEATABLE-READ — stepping to max + 1 again would retry the same
    // reference forever. Advancing past `lastTried` guarantees forward
    // progress without skipping a free number when the maximum did move.
    const next = Math.max(highest + 1, lastTried + 1);
    lastTried = next;

    const candidate = String(next).padStart(6, '0');

    try {
      await insert(candidate);
      return candidate;
    } catch (error: any) {
      if (!isDuplicateKey(error)) throw error;
      lastError = error;
      // Someone took this number between the read and the insert. Try again.
    }
  }

  throw new Error(
    `Could not allocate a unique payment reference after ${PAYMENT_REFERENCE_ATTEMPTS} attempts: ${
      lastError?.message || 'unknown error'
    }`,
  );
}
