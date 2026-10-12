import { normalizeExpirationDate } from './expiration-date';
import { toSafeNumber } from './utils';

/**
 * Pure logic for editing batch expiration dates without moving stock.
 *
 * Expiry lives on inventory_batches, never on products — products.expiration_date
 * is a denormalized cache of the soonest batch still in stock (see ./expiration).
 * So "set an expiration date" always resolves to one or more batch rows.
 *
 * The complication this module exists for: a product can hold stock with NO
 * batch rows to attach a date to. Migration 100 deliberately did not backfill
 * historical batches, and `adjustStock` only creates one when quantity > 0, so
 * stock received before batch tracking (or added without an expiry) is invisible
 * to the batch ledger. For those, setting an expiry has to register the existing
 * stock as an "opening" batch first. That records stock already counted in
 * products.stock — it must never change products.stock itself.
 */

export interface BatchCoverage {
  /** Units still in this batch. mysql2 returns DECIMAL as a string. */
  quantityRemaining: number;
}

export interface EditableBatch extends BatchCoverage {
  id: string;
}

export interface ExpirationUpdate {
  batchId: string;
  expirationDate?: string | null;
}

export interface OpeningBatchPlan {
  quantity: number;
  expirationDate: string;
}

export interface ResolvedExpirationEdits {
  /** Batch rows to UPDATE. A null date clears the expiry. */
  batchUpdates: Array<{ batchId: string; expirationDate: string | null }>;
  /** A new batch to register untracked stock under, or null. */
  openingBatch: OpeningBatchPlan | null;
  /** Batch ids that were refused (foreign to this product, or exhausted). */
  rejected: string[];
  /** False when the request resolves to nothing — lets the caller skip a transaction. */
  hasWork: boolean;
}

/**
 * How much of products.stock no live batch accounts for.
 *
 * Only batches with stock remaining count, matching the coverage rule used by
 * the expiring-soon report and `refreshProductExpirationCache`. Clamped at zero:
 * batches can over-cover stock (a correction lowered products.stock without
 * depleting them), and a negative remainder must never become a batch quantity.
 */
export function computeUntrackedQuantity(
  productStock: number,
  batches: BatchCoverage[]
): number {
  const stock = toSafeNumber(productStock);
  const covered = batches.reduce((sum, b) => {
    const remaining = toSafeNumber(b.quantityRemaining);
    return sum + (remaining > 0 ? remaining : 0);
  }, 0);

  return Math.max(0, stock - covered);
}

/**
 * Turns a save request into the exact set of writes to perform.
 *
 * Batch ids arrive from the browser, so every one is checked against the
 * product's own live batches. An exhausted batch is refused rather than updated:
 * it drives neither the expiring-soon report nor the expiration cache (both
 * require quantity_remaining > 0), so writing to it would be a silent no-op.
 */
export function resolveExpirationEdits({
  productStock,
  batches,
  updates,
  untrackedExpiration,
}: {
  productStock: number;
  batches: EditableBatch[];
  updates: ExpirationUpdate[];
  untrackedExpiration?: string | null;
}): ResolvedExpirationEdits {
  const editable = new Set(
    batches.filter((b) => toSafeNumber(b.quantityRemaining) > 0).map((b) => b.id)
  );

  const rejected: string[] = [];
  // Keyed by batch id so a duplicated id collapses to a single UPDATE with the
  // last value, instead of two conflicting writes whose order decides the result.
  const resolved = new Map<string, string | null>();

  for (const update of updates) {
    if (!editable.has(update.batchId)) {
      rejected.push(update.batchId);
      continue;
    }
    // normalizeExpirationDate returns null for blank AND for unparseable input.
    // Both mean "no date" here: expiry is optional, and writing garbage into a
    // column the expiring-soon report reads is worse than clearing it.
    resolved.set(update.batchId, normalizeExpirationDate(update.expirationDate));
  }

  const batchUpdates = Array.from(resolved, ([batchId, expirationDate]) => ({
    batchId,
    expirationDate,
  }));

  const untrackedDate = normalizeExpirationDate(untrackedExpiration);
  const untrackedQuantity = computeUntrackedQuantity(productStock, batches);
  // Both conditions matter: no date means the edit had no point, and no
  // untracked quantity means a batch would double-count stock and corrupt FIFO.
  const openingBatch =
    untrackedDate && untrackedQuantity > 0
      ? { quantity: untrackedQuantity, expirationDate: untrackedDate }
      : null;

  return {
    batchUpdates,
    openingBatch,
    rejected,
    hasWork: batchUpdates.length > 0 || openingBatch !== null,
  };
}
