import { toLocalDateTime, toLocalYmd } from './fiscal-utils';
import { withTransaction } from './mysql';
import { generateBatchId } from './batch-utils';
import { calculatePurchaseCosts } from './purchase-utils';
import { toSafeNumber } from './utils';
import { updateStockAndRecordMovement } from './stock-movements';

// Two lines on the same PO can share a productId (e.g. a Piece line and a
// Case line for the same product) — matching on productId alone would let one
// line's receipt pick up the other's landed cost/factor, and row order from the
// DB is not guaranteed. Resolution order:
//   1. exactly one line for the product -> that line (pre-feature PO / legacy payload)
//   2. both sides carry a sellingUnitId -> ids must match
//   3. otherwise compare factors, where a missing id/factor means the base unit (1)
type LineRef = { productId: string; sellingUnitId?: string | null; sellingUnitFactor?: number | string | null };

function findLine<T extends LineRef>(lines: T[], target: LineRef): T | undefined {
  const sameProduct = lines.filter((l) => l.productId === target.productId);
  if (sameProduct.length <= 1) return sameProduct[0];
  const byId = sameProduct.find(
    (l) => l.sellingUnitId && target.sellingUnitId && l.sellingUnitId === target.sellingUnitId,
  );
  if (byId) return byId;
  const factorOf = (x: LineRef) => toSafeNumber(x.sellingUnitFactor) || 1;
  return sameProduct.find(
    (l) => !(l.sellingUnitId && target.sellingUnitId) && factorOf(l) === factorOf(target),
  );
}

function parseDueDays(paymentTerms: string | undefined | null): number {
  if (!paymentTerms) return 0;
  const lower = paymentTerms.toLowerCase();
  if (lower.includes('cod') || lower.includes('cash')) return 0;
  const match = paymentTerms.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export async function processPurchaseOrderCreation(body: any, userId: string = 'system') {
  const {
    id,
    supplierId,
    supplierName,
    date,
    items,
    total,
    paymentMethod,
    status,
    reference,
    shipping,
    purchaseType,
    orderedBy,
    vatAmount,
    isInternalFinalization,
    receiveToWarehouse,
    receiveToWarehouseName
  } = body;

  const calculations = calculatePurchaseCosts(items, shipping || 0);
  const finalTotal = calculations.grandTotal;
  const finalVatAmount = calculations.vatAmount;
  const orderId = id || `po_${Date.now()}`;
  const formattedDate = toLocalDateTime(new Date(date || new Date()));

  return await withTransaction(async (connection) => {
    // Look up supplier payment terms to compute due_date
    const [supplierRows]: any = await connection.query(
      'SELECT payment_terms FROM suppliers WHERE id = ?',
      [supplierId]
    );
    const paymentTerms = supplierRows?.[0]?.payment_terms as string | undefined;
    const dueDays = parseDueDays(paymentTerms);
    const baseDateObj = new Date(date || new Date());
    const dueDateObj = new Date(baseDateObj);
    dueDateObj.setDate(dueDateObj.getDate() + dueDays);
    const formattedDueDate = toLocalYmd(dueDateObj);

    // 1. Insert or Update order
    // Using ON DUPLICATE KEY UPDATE to allow the same process to be used for initial (Pending)
    // and final (Approved) states without duplicate entries.
    const insertOrderQuery = `
      INSERT INTO purchase_orders (
        id, supplier_id, supplier_name, date, due_date, total, payment_method, status,
        reference_number, shipping_fee, ordered_by, vat_amount, warehouse_id, warehouse_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        due_date = COALESCE(due_date, VALUES(due_date)),
        updated_at = NOW()
    `;

    await connection.query(insertOrderQuery, [
      orderId,
      supplierId,
      supplierName,
      formattedDate,
      formattedDueDate,
      finalTotal,
      paymentMethod || '',
      (purchaseType === 'Receive' && (isInternalFinalization || status !== 'Pending')) ? 'Received' : (isInternalFinalization ? 'Approved' : (status || 'Pending')),
      reference || null,
      toSafeNumber(shipping),
      orderedBy || userId,
      finalVatAmount,
      receiveToWarehouse || null,
      receiveToWarehouseName || null
    ]);

    // 2. Insert items
    // First clear existing items if we are updating (id provided)
    if (id) {
        await connection.query('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [orderId]);
    }

    const insertItemQuery = `
      INSERT INTO purchase_order_items (
        id, purchase_order_id, product_id, product_name, quantity, cost,
        selling_price, discount, discount_type, vat_subject, subtotal,
        selling_unit_id, selling_unit_name, selling_unit_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const item of items) {
      const itemId = `poi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const quantity = toSafeNumber(item.quantity);
      const cost = toSafeNumber(item.cost);
      const discount = toSafeNumber(item.discount);
      const discountType = item.discountType || 'amount';

      let itemSubtotal = quantity * cost;
      if (discountType === 'percentage') {
        itemSubtotal = itemSubtotal - (itemSubtotal * (discount / 100));
      } else {
        itemSubtotal = itemSubtotal - discount;
      }

      await connection.query(insertItemQuery, [
        itemId,
        orderId,
        item.productId,
        item.productName,
        quantity,
        cost,
        item.sellingPrice ? toSafeNumber(item.sellingPrice) : null,
        discount,
        discountType,
        item.vatSubject ? 1 : 0,
        itemSubtotal,
        item.sellingUnitId || null,
        item.sellingUnitName || null,
        item.sellingUnitFactor ? toSafeNumber(item.sellingUnitFactor) : null,
      ]);
    }

    // 3. Auto-Receive Logic
    if (purchaseType === 'Receive' && (isInternalFinalization || status !== 'Pending')) {
        const receiptData = {
            id: orderId,
            receivedItems: items,
            receivedTotal: finalTotal,
            allocationStrategy: 'equal' // Default for new creation
        };
        await processPurchaseOrderReceipt(orderId, receiptData, userId, connection);
    }

    return { success: true, orderId };
  });
}

export async function processPurchaseOrderReceipt(orderId: string, receiptData: any, userId: string = 'system', existingConnection?: any) {
  const executeLogic = async (connection: any) => {
    const receivedItems = receiptData.receivedItems || receiptData.items;
    const receivedTotal = receiptData.receivedTotal || receiptData.total;
    const allocationStrategy = receiptData.allocationStrategy || 'equal';

    if (!receivedItems || !Array.isArray(receivedItems)) {
      throw new Error('No items provided for receipt');
    }

    // 1. Get PO details and items for landed cost calculation if not provided
    const [poRows]: any = await connection.query('SELECT shipping_fee, supplier_id FROM purchase_orders WHERE id = ?', [orderId]);
    if (!poRows || poRows.length === 0) throw new Error('Purchase order not found');
    
    const shipping = toSafeNumber(poRows[0].shipping_fee);
    const supplierId = poRows[0].supplier_id;

    // 2. We need items to calculate correct landed cost distribution
    const [itemRows]: any = await connection.query(
      'SELECT product_id as productId, product_name as productName, quantity, cost, selling_price as sellingPrice, discount, discount_type as discountType, vat_subject as vatSubject, selling_unit_id as sellingUnitId, selling_unit_factor as sellingUnitFactor FROM purchase_order_items WHERE purchase_order_id = ?',
      [orderId]
    );

    // 3. Calculate landed costs
    const calculations = calculatePurchaseCosts(
      itemRows.map((i: any) => ({ ...i, vatSubject: i.vatSubject === 1 })),
      shipping,
      12,
      allocationStrategy || 'equal'
    );

    const [defaultLevelResult]: any = await connection.query('SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1');
    const defaultLevelId = defaultLevelResult[0]?.id;

    // 4. Process each received item
    for (const receivedItem of receivedItems) {
      const calculatedItem = findLine(calculations.items, receivedItem);
      if (!calculatedItem) continue;

      const matchedRow = findLine<any>(itemRows, receivedItem);
      const factor = toSafeNumber(receivedItem.sellingUnitFactor ?? matchedRow?.sellingUnitFactor) || 1;

      // Convert once, at the boundary into base-unit-contracted tables
      // (inventory_batches, products.stock/cost/price, price levels).
      // Everything past this point is unchanged from before this feature.
      const quantityAdded = toSafeNumber(receivedItem.quantity) * factor;
      if (quantityAdded <= 0) continue;

      const landedCost = toSafeNumber(calculatedItem.landedCostPerUnit); // already per-piece (Task 3)
      // The PO line's selling price is in the LINE's own unit (e.g. per Case).
      const rawSellingPrice = toSafeNumber(receivedItem.sellingPrice || matchedRow?.sellingPrice);
      // Per-piece figure, used only for the inventory_batches row (base-unit contract).
      const sellingPrice = rawSellingPrice / factor;

      // Cost keeps the "highest wins" rule: a cheaper delivery never drops the
      // recorded cost on receipt.
      const [existingProductRows]: any = await connection.query(
        'SELECT cost FROM products WHERE id = ?',
        [receivedItem.productId]
      );
      const existingCost = toSafeNumber(existingProductRows?.[0]?.cost ?? 0);
      const finalCost = Math.max(existingCost, landedCost);

      await connection.query(
        'UPDATE products SET cost = ?, expiration_date = ?, updated_at = NOW() WHERE id = ?',
        [finalCost, receivedItem.expirationDate ? new Date(receivedItem.expirationDate).toISOString().slice(0, 10) : null, receivedItem.productId]
      );

      await applyPurchaseSellingPrice(
        connection,
        receivedItem.productId,
        receivedItem.sellingUnitId ?? matchedRow?.sellingUnitId ?? null,
        rawSellingPrice,
        defaultLevelId,
      );

      // --- BATCH COSTING: Record this delivery as a new inventory batch ---
      try {
        const batchId = generateBatchId();
        await connection.query(
          `INSERT INTO inventory_batches
             (id, product_id, purchase_order_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type)
           VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, 'purchase')`,
          [batchId, receivedItem.productId, orderId, quantityAdded, quantityAdded, landedCost, sellingPrice]
        );
      } catch (batchErr) {
        // Non-fatal: batch table may not exist yet (pre-migration). Log and continue.
        console.warn('[BatchCosting] Could not insert inventory_batch (migration pending?):', batchErr);
      }
      // --- END BATCH COSTING ---

      // Receive into this product's own stock, in base units — the same figure
      // the inventory_batches row above was written with, so batches and
      // products.stock can never drift apart. Nothing cascades to a family.
      await updateStockAndRecordMovement(
        receivedItem.productId,
        quantityAdded,
        'purchase',
        orderId,
        'purchase',
        `Received Purchase: ${orderId}`,
        connection
      );
    }

    // 5. Update PO status and received total
    await connection.query(
      'UPDATE purchase_orders SET status = ?, received_total = ?, updated_at = NOW() WHERE id = ?',
      ['Received', toSafeNumber(receivedTotal), orderId]
    );

    return { success: true };
  };

  if (existingConnection) {
    return await executeLogic(existingConnection);
  } else {
    return await withTransaction(executeLogic);
  }
}

/**
 * Write a PO line's selling price onto the product as the new price of the unit
 * it was bought in — replacing the old price, up or down. A blank/zero price
 * changes nothing.
 *
 * `unitId` NULL means the base unit (lines that predate selling units). Only a
 * BASE-unit price writes products.price; a Case line updates the Case's own
 * price and never a computed per-piece price, since price ÷ factor is not what
 * a piece sells for. The unit's untiered default-level row is kept in step,
 * because both product read paths promote the base unit's default-level row
 * into products.price and a stale one would undo the update.
 *
 * Used by PO receipt and by scripts/backfill-po-selling-prices.ts, so the two
 * can never disagree about what "apply a PO price" means.
 */
export async function applyPurchaseSellingPrice(
  connection: any,
  productId: string,
  unitId: string | null,
  price: number,
  defaultLevelId: string | number | null | undefined,
): Promise<{ applied: boolean; unitId: string | null; isBase: boolean }> {
  const newPrice = toSafeNumber(price);
  const [unitRows]: any = await connection.query(
    `SELECT id, is_base FROM product_selling_units
      WHERE product_id = ? AND (${unitId ? 'id = ?' : 'is_base = 1'})
      LIMIT 1`,
    unitId ? [productId, unitId] : [productId],
  );
  const unit = unitRows?.[0] ?? null;
  const isBase = !unit || unit.is_base === 1 || unit.is_base === true;
  if (!(newPrice > 0)) return { applied: false, unitId: unit?.id ?? null, isBase };

  if (isBase) {
    await connection.query('UPDATE products SET price = ?, updated_at = NOW() WHERE id = ?', [newPrice, productId]);
  }
  if (!unit) return { applied: true, unitId: null, isBase };

  await connection.query('UPDATE product_selling_units SET price = ? WHERE id = ?', [newPrice, unit.id]);

  if (defaultLevelId) {
    if (isBase) {
      // min_quantity 0: the base unit's DEFAULT-level row is the product's
      // everyday shelf price and must apply at every quantity.
      await connection.query(`
        INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity)
        VALUES (?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE price = VALUES(price), min_quantity = 0
      `, [unit.id, defaultLevelId, newPrice]);
    } else {
      // A non-base unit with no default-level row already falls back to its own
      // price; only refresh an existing untiered override so it doesn't keep
      // shadowing the new price. Tiered rows are deliberate bulk prices.
      await connection.query(
        `UPDATE product_selling_unit_price_levels SET price = ?
          WHERE selling_unit_id = ? AND price_level_id = ? AND min_quantity = 0`,
        [newPrice, unit.id, defaultLevelId],
      );
    }
  }
  return { applied: true, unitId: unit.id, isBase };
}
