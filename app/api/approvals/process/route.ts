import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { v4 as uuidv4 } from 'uuid';
import { adjustStock } from '@/app/(app)/inventory/history/actions';
import { processPurchaseOrderCreation, processPurchaseOrderReceipt } from '@/lib/purchase-actions';
import { processBadOrderCreation } from '@/lib/bad-order-actions';
import { processTransferStock } from '@/lib/transfer-actions';
import { processCompleteStockCount } from '@/lib/stock-count-actions';

export async function POST(request: NextRequest) {
  try {
    const { queueId, action, userId, notes } = await request.json();

    if (!queueId || !action || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    return await withTransaction(async (connection) => {
      // 1. Get the queue item
      const [queueItems]: any = await connection.query(
        'SELECT * FROM approval_queue WHERE id = ?',
        [queueId]
      );

      if (!queueItems || queueItems.length === 0) {
        throw new Error('Approval request not found');
      }

      const item = queueItems[0];
      if (item.status !== 'Pending') {
        throw new Error('This request has already been processed');
      }

      // 2. Get the current workflow step
      const [steps]: any = await connection.query(
        'SELECT * FROM approval_workflows WHERE transaction_type = ? AND step_order = ?',
        [item.transaction_type, item.current_step]
      );

      if (!steps || steps.length === 0) {
        throw new Error('Workflow step configuration not found');
      }

      const workflowStep = steps[0];

      // 3. Verify user has the required role
      const [users]: any = await connection.query(`
        SELECT u.username, ut.id as roleId, ut.name as roleName
        FROM users u 
        LEFT JOIN user_types ut ON u.user_type = ut.id OR u.user_type = ut.name
        WHERE u.uid = ?
      `, [userId]);

      if (!users || users.length === 0) {
        throw new Error('User not found');
      }
      
      const currentUserRole = users[0].roleId;
      const isAdmin = users[0].username === 'admin' || users[0].roleName === 'Admin' || users[0].roleName === 'Super Admin';

      if (!isAdmin && currentUserRole !== workflowStep.user_type_id) {
        // Find role names for better error message
        const [requiredRoles]: any = await connection.query('SELECT name FROM user_types WHERE id = ?', [workflowStep.user_type_id]);
        const requiredRoleName = requiredRoles[0]?.name || 'Unknown';
        throw new Error(`Permission denied. This step requires ${requiredRoleName} approval.`);
      }

      // 4. Record history
      await connection.query(
        'INSERT INTO approval_history (id, approval_queue_id, user_id, action, notes, step_number) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), queueId, userId, action, notes || '', item.current_step]
      );

      if (action === 'Reject') {
        await connection.query(
          "UPDATE approval_queue SET status = 'Rejected' WHERE id = ?",
          [queueId]
        );
        return NextResponse.json({ success: true, status: 'Rejected' });
      }

      // 5. Handle Approval
      // Check if there are more steps
      const [nextSteps]: any = await connection.query(
        'SELECT id FROM approval_workflows WHERE transaction_type = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1',
        [item.transaction_type, item.current_step]
      );

      if (nextSteps && nextSteps.length > 0) {
        // Move to next step
        await connection.query(
          'UPDATE approval_queue SET current_step = current_step + 1 WHERE id = ?',
          [queueId]
        );
        return NextResponse.json({ success: true, status: 'Moved to next step', nextStep: item.current_step + 1 });
      } else {
        // Final Approval! Execute the transaction.
        const txData = typeof item.transaction_data === 'string' ? JSON.parse(item.transaction_data) : item.transaction_data;
        
        console.log(`Final approval reached for ${item.transaction_type}. Executing...`);
        
        let result = { success: false, error: 'Unknown transaction type' };
        
        if (item.transaction_type === 'STOCK_ADJUSTMENT') {
          // Check if this is a transfer handled within the adjustment flow (fallback)
          if (txData.adjustmentType === 'transfer' && (txData.targetWarehouseId || txData.toWarehouseId)) {
            const transferRequest = {
              sourceWarehouseId: txData.warehouseId || txData.fromWarehouseId,
              targetWarehouseId: txData.targetWarehouseId || txData.toWarehouseId,
              transferDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
              reference: txData.referenceNo || 'BULK-TRF-FINAL',
              notes: txData.reason || 'Processed from Bulk Adjustment',
              items: [{
                productId: txData.productId,
                productName: txData.productName || 'Unknown',
                quantity: txData.quantity
              }]
            };
            const trfResult = await processTransferStock(transferRequest);
            result = { success: trfResult.success, error: trfResult.error || '' };
          } else {
            // Safety: If it's a removal but quantity is somehow positive, flip it
            let adjQty = txData.quantity;
            if (txData.adjustmentType === 'remove' && adjQty > 0) {
              adjQty = -adjQty;
            }
            const adjResult = await adjustStock(txData.productId, adjQty, txData.reason, item.created_by, true, txData.expirationDate || null);
            result = { success: adjResult.success, error: (adjResult as any).error || '' };
          }
        } else if (item.transaction_type === 'PURCHASE_ORDER') {
          const poResult = await processPurchaseOrderCreation({ ...txData, isInternalFinalization: true }, item.created_by);
          result = { success: poResult.success, error: (poResult as any).error || '' };
        } else if (item.transaction_type === 'RECEIVE_PO') {
          if (txData.id) {
            // Receipt of existing PO
            const rcptResult = await processPurchaseOrderReceipt(txData.id, txData, item.created_by);
            result = { success: rcptResult.success, error: (rcptResult as any).error || '' };
          } else {
            // Direct receipt (creation + receipt)
            const poResult = await processPurchaseOrderCreation({ ...txData, isInternalFinalization: true }, item.created_by);
            result = { success: poResult.success, error: (poResult as any).error || '' };
          }
        } else if (item.transaction_type === 'BAD_ORDER') {
          const boResult = await processBadOrderCreation({ ...txData, isInternalFinalization: true }, item.created_by);
          result = { success: boResult.success, error: (boResult as any).error || '' };
        } else if (item.transaction_type === 'STOCK_TRANSFER') {
          const trfResult = await processTransferStock({ ...txData, isInternalFinalization: true });
          result = { success: trfResult.success, error: trfResult.error || '' };
        } else if (item.transaction_type === 'STOCK_COUNT') {
          const scResult = await processCompleteStockCount(txData.stockCountId);
          result = { success: scResult.success, error: scResult.error || '' };
        } else if (item.transaction_type === 'REPACKAGING') {
          const { breakPack, consolidatePack } = await import('@/app/(app)/products/actions');
          if (txData.direction === 'consolidate') {
            const cpResult = await consolidatePack(
              txData.packId,
              txData.bulkId || null,
              txData.packQtyUsed,
              txData.manualFactor,
              txData.newProductData,
              item.created_by,
              true // isInternalFinalization
            );
            result = { success: cpResult.success, error: (cpResult as any).message || '' };
          } else {
            const rpResult = await breakPack(
              txData.parentId,
              txData.childId || null,
              txData.quantityToBreak,
              txData.manualFactor,
              txData.newProductData,
              item.created_by,
              true // isInternalFinalization
            );
            result = { success: rpResult.success, error: (rpResult as any).message || '' };
          }
        } else if (item.transaction_type === 'SHELF_TRANSFER') {
          const { updateProductShelfLocations } = await import('@/app/(app)/products/actions');
          const stResult = await updateProductShelfLocations(
            txData.updates,
            item.created_by,
            true // isInternalFinalization
          );
          result = { success: stResult.success, error: (stResult as any).message || '' };
        } else if (item.transaction_type === 'PRODUCT_CREATE') {
          const { addProduct } = await import('@/app/(app)/products/actions');
          const apResult = await addProduct(txData, item.created_by, true);
          result = { success: apResult.success, error: (apResult as any).message || '' };
        } else if (item.transaction_type === 'PRICE_UPDATE') {
          const { submitPriceUpdateBatch } = await import('@/app/(app)/products/bulk-price-update/actions');
          const puResult = await submitPriceUpdateBatch(txData.warehouseId, txData.items, item.created_by, true);
          result = { success: puResult.success, error: (puResult as any).message || '' };
        }

        if (!result.success) {
          throw new Error('Finalization failed: ' + (result as any).error);
        }

        await connection.query(
          "UPDATE approval_queue SET status = 'Approved' WHERE id = ?",
          [queueId]
        );

        return NextResponse.json({ success: true, status: 'Finalized' });
      }
    });
  } catch (error: any) {
    console.error('Error processing approval:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
