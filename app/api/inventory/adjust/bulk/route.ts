import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, query } from '@/lib/mysql';
import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { deductFamilyStock, addFamilyStock, findUltimateRoot } from '@/lib/family-sync';

/**
 * Bulk Stock Adjustment API
 * Handles adjusting stock for multiple products in a single operation.
 * Supports multi-level approval and family stock synchronization.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      adjustments, 
      notes: batchNotes, 
      userId = 'system',
      warehouseId,
      targetWarehouseId,
      referenceNo,
      supplierId,
      adjustmentType = 'add'
    } = body;

    if (!adjustments || !Array.isArray(adjustments) || adjustments.length === 0) {
      return NextResponse.json({ success: false, error: 'No adjustments provided' }, { status: 400 });
    }

    const results: any[] = [];
    const queuedItems: any[] = [];

    // 2. Process each adjustment
    await withTransaction(async (connection) => {
      for (const adj of adjustments) {
        const { productId, quantity, reason, targetProductId: itemTargetProductId, expirationDate } = adj;

        if (!productId || quantity === undefined) {
          throw new Error(`Invalid adjustment details for product ${productId}`);
        }

        if (quantity === 0) continue;

        // Fetch product info
        const [productResult]: any = await connection.query(
          'SELECT stock, name, sku, barcode, unit_of_measure FROM products WHERE id = ?',
          [productId]
        );

        if (!productResult || productResult.length === 0) {
          throw new Error(`Product not found: ${productId}`);
        }

        const product = productResult[0];
        const currentStock = parseInt(product.stock);
        const finalReason = reason || batchNotes || (adjustmentType === 'transfer' ? 'Bulk Transfer' : 'Bulk Adjustment');

        const isTransfer = adjustmentType === 'transfer';
        const finalQuantity = (adjustmentType === 'remove' || isTransfer) ? -Math.abs(quantity) : Math.abs(quantity);
        const approvalType = isTransfer ? 'STOCK_TRANSFER' : 'STOCK_ADJUSTMENT';
        const isApprovalRequiredForItem = await checkApprovalRequired(approvalType);

        if (isApprovalRequiredForItem) {
          // Resolve warehouse name if warehouseId is provided
          let resolvedWarehouseName: string | null = null;
          if (warehouseId) {
            const [whRow]: any = await connection.query('SELECT name FROM warehouses WHERE id = ?', [warehouseId]);
            resolvedWarehouseName = whRow?.[0]?.name || null;
          }

          // Submit to approval queue with enriched metadata
          const approvalData: any = {
            productId,
            quantity: finalQuantity, // Correctly signed quantity
            reason: finalReason,
            productName: product.name,
            productSku: product.sku,
            productBarcode: product.barcode,
            currentStock: currentStock,
            warehouseId,
            warehouseName: resolvedWarehouseName,
            referenceNo,
            supplierId,
            adjustmentType,
            expirationDate: expirationDate || null
          };

          if (isTransfer) {
            // Match TransferStockRequest structure for compatibility
            approvalData.sourceWarehouseId = warehouseId;
            approvalData.targetWarehouseId = targetWarehouseId;
            approvalData.transferDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
            approvalData.reference = referenceNo;
            approvalData.notes = finalReason;
            approvalData.items = [{
              productId,
              productName: product.name,
              quantity: Math.abs(quantity), // Transfers use positive quantities for the item list
              unitOfMeasure: product.unit_of_measure
            }];

            // Add warehouse names for better UI in Approval Center
            const [sourceResult, targetResult]: any = await Promise.all([
              connection.query(`SELECT name FROM warehouses WHERE id = ?`, [warehouseId]),
              connection.query(`SELECT name FROM warehouses WHERE id = ?`, [targetWarehouseId])
            ]);
            
            // connection.query returns [rows, fields]
            const sourceRows = sourceResult[0];
            const targetRows = targetResult[0];
            
            approvalData.fromWarehouseName = sourceRows[0]?.name || 'Unknown';
            approvalData.toWarehouseName = targetRows[0]?.name || 'Unknown';
          }

          const { queueId, pendingApproval } = await submitToApprovalQueue(approvalType, approvalData, userId);

          if (pendingApproval) {
            queuedItems.push({ productId, productName: product.name, queueId, type: approvalType });
            continue;
          }
        }

        // Immediate Execution
        const newStock = currentStock + finalQuantity;
        
        if (newStock < 0 && (adjustmentType === 'remove' || isTransfer)) {
          throw new Error(`Adjustment would result in negative stock for ${product.name} at source`);
        }

        // For transfers, we need to find the target product
        let destId = itemTargetProductId;
        if (isTransfer && !destId && targetWarehouseId) {
          const [targetProduct]: any = await connection.query(
            'SELECT id, name FROM products WHERE sku = ? AND warehouse_id = ?',
            [product.sku, targetWarehouseId]
          );
          if (targetProduct && targetProduct.length > 0) {
            destId = targetProduct[0].id;
          } else {
            throw new Error(`Product ${product.name} (SKU: ${product.sku}) not found in target warehouse.`);
          }
        }

        const adjustmentId = `adj_bulk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // Create adjustment record with new metadata
        await connection.query(
          `INSERT INTO stock_adjustments 
            (id, product_id, quantity, reason, new_stock, warehouse_id, target_warehouse_id, reference_no, supplier_id, note, adj_type) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            adjustmentId, 
            productId, 
            finalQuantity, 
            finalReason, 
            newStock, 
            warehouseId || null, 
            targetWarehouseId || null, 
            referenceNo || null, 
            supplierId || null, 
            batchNotes || null, 
            adjustmentType
          ]
        );

        // Handle Transfer Logic (Increase Target Stock)
        if (isTransfer && destId) {
          await connection.query(
            'UPDATE products SET stock = stock + ? WHERE id = ?',
            [Math.abs(quantity), destId]
          );
        }

        // Sync family stock
        const { rootId, factorToRoot } = await findUltimateRoot(productId, connection);

        const syncQty = Math.abs(finalQuantity) / factorToRoot;
        if (finalQuantity < 0) {
          await deductFamilyStock(rootId, syncQty, adjustmentId, 'adjustment', finalReason, connection);
        } else {
          await addFamilyStock(rootId, syncQty, adjustmentId, 'adjustment', finalReason, connection, 0, expirationDate, productId);
        }

        results.push({ productId, productName: product.name, newStock });
      }
    });

    return NextResponse.json({
      success: true,
      processed: results.length,
      queued: queuedItems.length,
      results,
      queuedItems,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Bulk stock adjustment error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process bulk adjustment' },
      { status: 500 }
    );
  }
}
