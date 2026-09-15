import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../lib/mysql';
import { baseQuantity, getBaseUnit } from '@/lib/selling-units';
import { updateStockAndRecordMovement } from '@/lib/stock-movements';
import { isService } from '@/lib/product-type';

/**
 * Marks a sales order as Delivered. This is the point at which inventory is
 * actually deducted (a sales order is a commitment; stock leaves on delivery).
 * Only a Pending order can be delivered.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const resolvedParams = params instanceof Promise ? await params : params;
  const orderId = resolvedParams.id;

  try {
    return await withTransaction(async (connection) => {
      // 1. Load the order and guard its status
      const [orderRows]: any = await connection.query(
        'SELECT id, reference, status FROM sales_orders WHERE id = ?',
        [orderId]
      );
      const order = orderRows[0];
      if (!order) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
      }
      if (order.status !== 'Pending') {
        return NextResponse.json(
          { success: false, error: `Only a Pending order can be delivered (current status: ${order.status}).` },
          { status: 400 }
        );
      }

      // 2. Load items, with each product's type: services carry no stock, so
      //    they must be excluded from both the availability check and the
      //    deduction below. Without this a service (always stock 0) blocks the
      //    whole delivery, and with negative inventory enabled it would instead
      //    drive the service's stock negative.
      const [items]: any = await connection.query(
        `SELECT soi.product_id, soi.product_name, soi.quantity, soi.selling_unit_factor, p.type
         FROM sales_order_items soi
         LEFT JOIN products p ON p.id = soi.product_id
         WHERE soi.sales_order_id = ?`,
        [orderId]
      );

      const stockedItems = items.filter((item: any) => !isService(item));

      // 2b. Resolve each line into BASE units once, up front, so the availability
      //     check below and the deduction that follows can never disagree.
      //     A line's own recorded factor wins (the order was placed in that unit);
      //     an order written before selling units has NULL, so fall back to the
      //     product's base unit, then to factor 1.
      const linesInBase: Array<{ item: any; qtyInBase: number }> = [];
      for (const item of stockedItems) {
        let factor = Number(item.selling_unit_factor ?? 0);
        if (!Number.isFinite(factor) || factor <= 0) {
          const base = await getBaseUnit(item.product_id, connection);
          factor = base ? base.factor : 1;
        }
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty)) {
          throw new Error(
            `Invalid quantity on order item for product ${item.product_id}: ${item.quantity}`
          );
        }
        linesInBase.push({ item, qtyInBase: baseQuantity(qty, factor) });
      }

      // 3. Stock availability check (unless negative inventory is allowed).
      //    products.stock is in base units, so the requested figure must be too.
      const [settingsResult]: any = await connection.query('SELECT enable_negative_inventory FROM pos_settings LIMIT 1');
      const enableNegativeInventory = settingsResult.length > 0 ? !!settingsResult[0].enable_negative_inventory : false;

      if (!enableNegativeInventory) {
        for (const { item, qtyInBase } of linesInBase) {
          const [stockResult]: any = await connection.query('SELECT stock, name FROM products WHERE id = ?', [item.product_id]);
          if (stockResult && stockResult.length > 0 && stockResult[0].stock < qtyInBase) {
            throw new Error(`Insufficient stock for product: ${stockResult[0].name}. Current stock: ${stockResult[0].stock}, Requested: ${qtyInBase}`);
          }
        }
      }

      // 4. Deduct stock — one product, one stock figure, in base units.
      for (const { item, qtyInBase } of linesInBase) {
        await updateStockAndRecordMovement(
          item.product_id,
          -qtyInBase,
          'sale',
          orderId,
          'sale',
          `Delivery of Sales Order: ${order.reference || orderId} (${item.product_name})`,
          connection as any
        );
      }

      // 5. Flip status to Delivered
      await connection.query("UPDATE sales_orders SET status = 'Delivered', updated_at = NOW() WHERE id = ?", [orderId]);

      return NextResponse.json({ success: true, message: 'Order delivered and stock deducted.', data: { id: orderId } });
    });
  } catch (error: any) {
    console.error('Error delivering sales order:', error);
    const status = error.message?.includes('Insufficient stock') ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message || 'Failed to deliver order' }, { status });
  }
}
