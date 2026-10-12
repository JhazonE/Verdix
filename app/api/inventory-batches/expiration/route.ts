import { NextRequest, NextResponse } from 'next/server';

import { resolveExpirationEdits } from '@/lib/batch-expiration-edit';
import { applyExpirationEdits } from '@/lib/batch-expiration-write';
import { query, withTransaction } from '@/lib/mysql';

/**
 * Edits batch expiration dates without moving any stock.
 *
 * Until now an expiry could only be set while ADDING stock (the Adjust Stock
 * dialog hides the field unless adjustmentType === 'add'), so stock already on
 * the shelf could never be dated. This endpoint closes that gap: it writes
 * inventory_batches.expiration_date and nothing else.
 *
 * products.stock is never touched. Not even when an opening batch is created —
 * that registers stock already counted in products.stock into the batch ledger
 * so it can carry a date, which is a bookkeeping correction, not a movement. No
 * stock_movements row is written for the same reason: there is no quantity
 * change to record.
 *
 * No approval gate: a date edit has no financial impact, so unlike
 * STOCK_ADJUSTMENT it applies immediately (the caller logs the activity).
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const productId = String(body?.productId || '').trim();
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    const untrackedExpiration = body?.untrackedExpiration ?? null;

    if (!productId) {
      return NextResponse.json(
        { success: false, error: 'productId is required' },
        { status: 400 }
      );
    }

    const productRows: any[] = await query(
      'SELECT id, stock, cost, price, is_perishable FROM products WHERE id = ?',
      [productId]
    );
    if (productRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Product not found' },
        { status: 404 }
      );
    }
    const product = productRows[0];

    // Read the product's own batches, so a batch id from the browser can never
    // reach a row belonging to a different product.
    const batchRows: any[] = await query(
      `SELECT id, quantity_remaining AS quantityRemaining
       FROM inventory_batches
       WHERE product_id = ?`,
      [productId]
    );

    const plan = resolveExpirationEdits({
      productStock: product.stock,
      batches: batchRows.map((b) => ({
        id: String(b.id),
        quantityRemaining: b.quantityRemaining,
      })),
      updates: updates.map((u: any) => ({
        batchId: String(u?.batchId ?? ''),
        expirationDate: u?.expirationDate ?? null,
      })),
      untrackedExpiration,
    });

    if (plan.rejected.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Some batches could not be updated because they no longer hold stock or do not belong to this product. Reload and try again.',
          rejected: plan.rejected,
        },
        { status: 409 }
      );
    }

    if (!plan.hasWork) {
      return NextResponse.json({ success: true, updated: 0, openingBatchId: null });
    }

    const result = await withTransaction((connection) =>
      applyExpirationEdits(connection, {
        productId,
        plan,
        unitCost: product.cost ? parseFloat(product.cost) : 0,
        sellingPrice: product.price ? parseFloat(product.price) : 0,
      })
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('Error updating batch expiration dates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update expiration dates' },
      { status: 500 }
    );
  }
}
