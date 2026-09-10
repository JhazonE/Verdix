import { query, withTransaction } from './mysql';
import { v4 as uuidv4 } from 'uuid';
import { updateStockAndRecordMovement } from './stock-movements';

export async function processBadOrderCreation(body: any, userId: string) {
  try {
    const {
      purchaseOrderId,
      supplierId,
      supplierName,
      reportedBy,
      reportDate,
      status,
      items,
      notes,
      warehouseId,
      warehouseName,
      shelfId,
      shelfName,
      isInternalFinalization = false
    } = body;

    if (!items || items.length === 0) {
      return { success: false, error: 'Missing required fields: items' };
    }

    // Process creation
    return await withTransaction(async (connection) => {
        // Generate bad order ID
        const badOrderId = `bo_${Date.now()}`;

        // Calculate total affected value
        const totalAffectedValue = items.reduce((acc: number, item: any) => {
            return acc + (item.cost * (item.quantity || 0));
        }, 0);

        // Format date for MySQL
        const formattedDate = reportDate 
            ? new Date(reportDate).toISOString().slice(0, 19).replace('T', ' ')
            : new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Insert bad order
        const insertOrderQuery = `
            INSERT INTO bad_orders (
                id, purchase_order_id, supplier_id, supplier_name, reported_by,
                report_date, status, total_affected_value, notes,
                warehouse_id, warehouse_name, shelf_id, shelf_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        await connection.query(insertOrderQuery, [
            badOrderId,
            purchaseOrderId || null,
            supplierId || null,
            supplierName || null,
            reportedBy || userId || null,
            formattedDate,
            status || 'Reported',
            totalAffectedValue,
            notes || null,
            warehouseId || null,
            warehouseName || null,
            shelfId || null,
            shelfName || null,
        ]);

        // Insert bad order items
        const insertItemQuery = `
            INSERT INTO bad_order_items (
                id, bad_order_id, product_id, product_name, quantity, cost, reason, description
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const item of items) {
            const itemId = `boi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            await connection.query(insertItemQuery, [
                itemId,
                badOrderId,
                item.productId,
                item.productName,
                item.quantity,
                item.cost,
                item.reason,
                item.description || null,
            ]);

            // Write off this product's own stock, which is already in base units.
            // One product, one stock figure — nothing cascades to another product.
            const quantityRemoved = parseFloat(item.quantity) || 0;

            if (quantityRemoved > 0) {
                await updateStockAndRecordMovement(
                    item.productId,
                    -quantityRemoved,
                    'adjustment', // Using adjustment as the movement type for bad orders
                    badOrderId,
                    'adjustment',
                    `Bad Order: ${item.reason || 'Not specified'} (${badOrderId})`,
                    connection
                );
            }
        }

        return { success: true, badOrderId };
    });
  } catch (error: any) {
    console.error('Error in processBadOrderCreation:', error);
    return { success: false, error: error.message };
  }
}
