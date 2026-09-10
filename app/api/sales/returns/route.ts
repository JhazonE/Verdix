import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction, getNextMCNumber } from '@/lib/mysql';
import { baseQuantity, getBaseUnit } from '@/lib/selling-units';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      saleId,
      items, // Array of { productId, productName, quantity, price }
      terminalId,
      userId,
      // The shift this return belongs to. Without it the pos_transactions row
      // is written with shift_id NULL, and every shift-scoped report — the
      // X-reading above all, which is GROUP BY pt.shift_id — silently drops
      // the return into a NULL group belonging to no shift.
      shiftId,
      reason,
      totalAmount
    } = body;

    if (!saleId || !items || items.length === 0) {
      return NextResponse.json({ success: false, error: 'Sale ID and items are required' }, { status: 400 });
    }

    const result = await withTransaction(async (connection) => {
      // Find a valid user ID if none provided (last resort to avoid FK error)
      let finalUserId = userId;
      if (!finalUserId) {
        const [userResult]: any = await connection.query('SELECT uid FROM users LIMIT 1');
        finalUserId = userResult?.[0]?.uid || 'system'; // 'system' might still fail if not in users
      }

      const posTransId = `RTN-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      // Allocate the Merchandise Credit number on THIS connection so it rolls
      // back with the transaction — a gap here would not match the paper slips.
      const mcNumber = await getNextMCNumber(connection);

      // 1. Insert into pos_transactions
      // If the caller did not supply a shift, fall back to the terminal's
      // currently-open shift rather than writing NULL: a NULL shift_id makes
      // the return invisible to every shift-scoped report.
      let finalShiftId = shiftId || null;
      if (!finalShiftId && terminalId) {
        const [openShift]: any = await connection.query(
          "SELECT id FROM shifts WHERE terminal_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1",
          [terminalId]
        );
        finalShiftId = openShift?.[0]?.id || null;
      }

      const insertPosTransSql = `
        INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, mc_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, notes, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'return', ?, ?, 0, 0, ?, 'Return', 'completed', ?, NOW(), NOW(), NOW())
      `;

      await connection.query(insertPosTransSql, [
        posTransId,
        saleId,
        finalShiftId,
        finalUserId,
        terminalId || null,
        mcNumber,
        -totalAmount, // Negative since it's a return/outflow of money from business
        -totalAmount,
        reason || 'Merchandise Credit'
      ]);

      const insertItemSql = `
        INSERT INTO pos_transaction_items (
          id, pos_transaction_id, sale_item_id, product_id, product_name,
          quantity, unit_price, line_total,
          selling_unit_id, selling_unit_name, selling_unit_factor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      // First, create sale_items for this return transaction
      const insertSaleItemSql = `
        INSERT INTO sale_items (
          id, sale_id, product_id, product_name, quantity, price,
          selling_unit_id, selling_unit_name, selling_unit_factor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const saleItemId = `${posTransId}-ITEM-${i + 1}`;
        const posItemId = `${posTransId}-DETAIL-${i + 1}`;

        const returnedQty = Number(item.quantity);
        if (!Number.isFinite(returnedQty)) {
          throw new Error(`Invalid return quantity for product ${item.productId}: ${item.quantity}`);
        }

        // --- SELLING UNIT RESOLUTION ---
        // A return must give back exactly what the sale took, so the unit comes
        // from the ORIGINAL sale line wherever we can find it — not from the
        // product's units as they stand today. A unit edited since the sale must
        // not change how much stock the return restores.
        //
        // Fallbacks, in order: the caller's explicit unit (an operator returning
        // in a different unit on purpose), then the product's base unit, then
        // factor 1. A pre-selling-unit sale line has NULL, which means 1.
        let unitId: string | null = null;
        let unitName: string | null = null;
        let factor = 0;

        const [originalLine]: any = await connection.query(
          `SELECT selling_unit_id, selling_unit_name, selling_unit_factor
           FROM sale_items
           WHERE sale_id = ? AND product_id = ? AND quantity > 0
           ORDER BY created_at ASC LIMIT 1`,
          [saleId, item.productId]
        );
        if (originalLine && originalLine.length > 0) {
          unitId = originalLine[0].selling_unit_id ?? null;
          unitName = originalLine[0].selling_unit_name ?? null;
          factor = Number(originalLine[0].selling_unit_factor ?? 1);
        }

        if (!Number.isFinite(factor) || factor <= 0) {
          unitId = item.sellingUnitId ?? null;
          unitName = item.sellingUnitName ?? null;
          factor = Number(item.sellingUnitFactor ?? 0);
        }
        if (!Number.isFinite(factor) || factor <= 0) {
          const base = await getBaseUnit(item.productId, connection);
          if (base) {
            unitId = base.id;
            unitName = base.name;
            factor = base.factor;
          } else {
            unitId = null;
            unitName = null;
            factor = 1;
          }
        }
        // --- END SELLING UNIT RESOLUTION ---

        // Create sale_item entry
        await connection.query(insertSaleItemSql, [
          saleItemId,
          saleId,
          item.productId,
          item.productName,
          -returnedQty, // Negative for returns
          item.price,
          unitId,
          unitName,
          factor
        ]);

        // Create pos_transaction_item entry referencing the sale_item
        await connection.query(insertItemSql, [
          posItemId,
          posTransId,
          saleItemId, // Reference the sale_item we just created
          item.productId,
          item.productName,
          -returnedQty, // Negative quantity
          item.price,
          -(returnedQty * item.price),
          unitId,
          unitName,
          factor
        ]);

        // --- Inventory Addition ---
        // One product, one stock figure, in base units. A selling unit only says
        // how many base units one of it is worth, so a return is a single add —
        // there is no family to cascade through any more.
        const [soldProdResult]: any = await connection.query(
          'SELECT id, name FROM products WHERE id = ?',
          [item.productId]
        );

        if (soldProdResult && soldProdResult.length > 0) {
          const soldProd = soldProdResult[0];
          await updateStockAndRecordMovement(
            soldProd.id,
            baseQuantity(returnedQty, factor),
            'return',
            posTransId,
            'return',
            `Return for Sale: ${saleId}${factor !== 1 ? ` (${returnedQty} × ${unitName})` : ''}`,
            connection
          );
        }
      }

      // 3. Update original sale status if needed (Optional: could mark as 'Returned' or keep it as 'Paid' but has return links)
      // For now, let's keep it simple and just record the return transaction.
      // The returns page looks for transaction_type = 'return'.

      const [meta]: any = await connection.query(
        `SELECT DATE(transaction_time) AS d, terminal_id AS t FROM pos_transactions WHERE id = ? LIMIT 1`,
        [posTransId]
      );
      const d = meta?.[0]?.d ? String(meta[0].d) : null;
      const t = meta?.[0]?.t ?? 'all';

      return { posTransId, mcNumber, d, t };
    });

    if (result.d) {
      saveEJournalFiles(result.d, result.t).catch((e) => console.error('e-journal auto-save failed:', e));
    }

    return NextResponse.json({
      success: true,
      data: { posTransId: result.posTransId, mcNumber: result.mcNumber },
      message: 'Return processed successfully'
    });

  } catch (error: any) {
    console.error('Error processing return:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process return' },
      { status: 500 }
    );
  }
}
