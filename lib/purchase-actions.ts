import { withTransaction } from './mysql';
import { generateBatchId } from './batch-utils';
import { calculatePurchaseCosts } from './purchase-utils';
import { toSafeNumber } from './utils';
import { updateStockAndRecordMovement } from './stock-movements';

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
  const formattedDate = new Date(date || new Date()).toISOString().slice(0, 19).replace('T', ' ');

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
    const formattedDueDate = dueDateObj.toISOString().slice(0, 10);

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
        selling_price, discount, discount_type, vat_subject, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        itemSubtotal
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
      'SELECT product_id as productId, product_name as productName, quantity, cost, selling_price as sellingPrice, discount, discount_type as discountType, vat_subject as vatSubject FROM purchase_order_items WHERE purchase_order_id = ?',
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
      const calculatedItem = calculations.items.find(ci => ci.productId === receivedItem.productId);
      if (!calculatedItem) continue;

      const quantityAdded = toSafeNumber(receivedItem.quantity);
      if (quantityAdded <= 0) continue;

      const landedCost = toSafeNumber(calculatedItem.landedCostPerUnit);
      const sellingPrice = toSafeNumber(receivedItem.sellingPrice || itemRows.find((i: any) => i.productId === receivedItem.productId)?.sellingPrice);

      // "Highest wins" rule (applies to both cost AND retail price):
      // Fetch the product's current cost and price from the DB. If the new landed cost
      // (or new selling price) is lower than what's already recorded — e.g. the supplier
      // gave a cheaper price this time — keep the higher value so the product's cost and
      // retail never drop unexpectedly on receipt. A blank/zero PO selling price cannot
      // lower retail either, since max(existingPrice, 0) preserves the existing price.
      const [existingProductRows]: any = await connection.query(
        'SELECT cost, price FROM products WHERE id = ?',
        [receivedItem.productId]
      );
      const existingCost = toSafeNumber(existingProductRows?.[0]?.cost ?? 0);
      const finalCost = Math.max(existingCost, landedCost);
      const existingPrice = toSafeNumber(existingProductRows?.[0]?.price ?? 0);
      const finalPrice = Math.max(existingPrice, sellingPrice);

      // Update cost and price for the specific product received
      await connection.query(
        'UPDATE products SET cost = ?, price = ?, expiration_date = ?, updated_at = NOW() WHERE id = ?',
        [finalCost, finalPrice, receivedItem.expirationDate ? new Date(receivedItem.expirationDate).toISOString().slice(0, 10) : null, receivedItem.productId]
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

      // Update default price level — use finalPrice so it stays consistent with the
      // master products.price under the "highest wins" rule. Price levels are per
      // selling unit now (product_selling_unit_price_levels); this writes onto the
      // product's BASE selling unit, matching how every other write path in this
      // codebase treats "the product's own price level" after the selling-units
      // migration.
      if (defaultLevelId && finalPrice > 0) {
        const [baseUnitRows]: any = await connection.query(
          'SELECT id FROM product_selling_units WHERE product_id = ? AND is_base = 1 LIMIT 1',
          [receivedItem.productId],
        );
        if (baseUnitRows.length > 0) {
          await connection.query(`
            INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE price = VALUES(price)
          `, [baseUnitRows[0].id, defaultLevelId, finalPrice]);
        }
      }
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
