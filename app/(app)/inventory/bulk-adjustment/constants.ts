import { Repeat, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import type { Product } from '@/lib/types';

export type AdjustmentType = 'add' | 'remove' | 'transfer';

export interface AdjustmentItem {
  product: Product;
  quantity: number;
  type: AdjustmentType;
  expirationDate?: string;
  /**
   * Cost per base unit for this line, as a raw input string so the field can be
   * cleared and retyped without the value snapping back to 0 mid-edit. Seeded
   * from the product's standing cost when the item is added.
   *
   * An empty string means "no cost captured" and the server falls back to
   * `products.cost`; '0' is a real cost (a free case, a sample) and is kept.
   */
  unitCost?: string;
  // No per-item reason: the batch's Memo / Reason in the config panel is the
  // one place a reason is written, and it applies to every item.
}

/**
 * Parses a cost field into what the API expects: `null` for "not captured",
 * otherwise the number. Shared so the table, the card, the totals and the
 * submit payload never disagree about what a blank field means.
 */
export function parseUnitCost(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Frozen-column geometry for the desktop batch table.
 *
 * Product / Type / Quantity stay pinned while Cost, Impact, Expiry and the
 * delete button scroll horizontally — adding the cost column pushed the delete
 * button off the pane, and losing the product name while scrolling to reach it
 * made the row impossible to read.
 *
 * The `left` offsets are the SUM of the widths of the frozen columns before
 * each one, so they must be kept in step with the <TableHead> widths in
 * BulkAdjustmentClient.tsx: Product 240px, Type 110px, Quantity 150px. They
 * live here rather than in either component because the header cells and the
 * body cells must agree exactly — a mismatch shows up as a column that drifts
 * out of alignment only once the user scrolls.
 *
 * Fixed pixel widths (not `min-w`) on the frozen columns are what make these
 * offsets true: a column allowed to size to its content would leave the
 * offsets pointing at the wrong place.
 */
export const FROZEN_CELL = 'sticky z-20 bg-card group-hover:bg-accent/50 transition-colors';
/**
 * The header's frozen cells. They sit at the intersection of both sticky axes,
 * so they must outrank BOTH the scrolling header cells they travel over and
 * the frozen body cells that scroll up underneath them — hence a z above
 * FROZEN_CELL's, and no hover tint, since the header is not a row.
 */
export const FROZEN_HEAD = 'sticky top-0 z-40 bg-card';
export const FROZEN_TYPE_LEFT = 'left-[240px]';
export const FROZEN_QTY_LEFT = 'left-[350px]';
/** The seam between the frozen block and the scrolling columns. */
export const FROZEN_EDGE = 'shadow-[inset_-1px_0_0_hsl(var(--border))]';

export const typeConfig: Record<AdjustmentType, { label: string; color: string; icon: LucideIcon; dot: string }> = {
  add:      { label: 'Add Stock',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: TrendingUp,   dot: 'bg-emerald-500' },
  remove:   { label: 'Remove Stock', color: 'bg-red-50 text-red-700 border-red-200',             icon: TrendingDown, dot: 'bg-red-500'     },
  transfer: { label: 'Transfer',     color: 'bg-blue-50 text-blue-700 border-blue-200',           icon: Repeat,       dot: 'bg-blue-500'   },
};
