import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../lib/mysql';
import { getExternalApiConfig } from '../../../../lib/external-api-config';
import { syncPurchaseTransaction, syncAccountsPayable } from '../../../../lib/services/external-accounting-api';
import { calculatePurchaseCosts } from '../../../../lib/purchase-utils';
import { toSafeNumber } from '../../../../lib/utils';
import { checkApprovalRequired, submitToApprovalQueue } from '../../../../lib/approvals';
import { processPurchaseOrderReceipt } from '../../../../lib/purchase-actions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { 
      supplierId, 
      supplierName, 
      date, 
      deliveryDate, 
      total, 
      shipping, 
      reference, 
      note, 
      paymentMethod,
      items,
      // Status update only fields
      status, 
      receivedTotal,
      vatAmount,
      receivedItems, // New field for partial/full receipt
      allocationStrategy,
      isInternalFinalization,
      userId
    } = body;

    // 0. Check for RECEIVE_PO approval if status is moving to Received
    if (status === 'Received' && !isInternalFinalization) {
      const isApprovalRequired = await checkApprovalRequired('RECEIVE_PO');
      if (isApprovalRequired) {
        const { queueId, pendingApproval } = await submitToApprovalQueue('RECEIVE_PO', { ...body, id }, userId || 'system');
        
        if (pendingApproval) {
          return NextResponse.json({
            success: true,
            pendingApproval: true,
            data: { queueId },
            message: 'Purchase receipt submitted for approval'
          });
        }
      }
    }

    // 0.1 Check for PURCHASE_ORDER approval if status explicitly moving to Approved (Bypassing queue)
    if (status === 'Approved' && !isInternalFinalization) {
        const isApprovalRequired = await checkApprovalRequired('PURCHASE_ORDER');
        if (isApprovalRequired) {
          return NextResponse.json({
            success: false,
            error: 'Direct approval restricted. This order must go through the multi-level approval process.'
          }, { status: 403 });
        }
    }

    // Only touch total/vatAmount when the caller actually sent one — e.g. the
    // "Receive" action doesn't resend `total`, and toSafeNumber(undefined) is 0,
    // which previously zeroed out the order's total on every receipt.
    let finalTotal: number | undefined = total !== undefined ? toSafeNumber(total) : undefined;
    let finalVatAmount: number | undefined = vatAmount !== undefined ? toSafeNumber(vatAmount) : undefined;

    if (items && Array.isArray(items)) {
      const calculations = calculatePurchaseCosts(items, shipping !== undefined ? shipping : 0);
      finalTotal = calculations.grandTotal;
      finalVatAmount = calculations.vatAmount;
    }

    return await withTransaction(async (connection) => {
      // 1. Build and execute dynamic update query for the purchase order
      let sql = 'UPDATE purchase_orders SET ';
      const paramsUpdate: any[] = [];
      const updates: string[] = [];

      if (status) {
        updates.push('status = ?');
        paramsUpdate.push(status);
      }
      if (receivedTotal !== undefined) {
        updates.push('received_total = ?');
        paramsUpdate.push(toSafeNumber(receivedTotal));
      }
      if (supplierId) {
        updates.push('supplier_id = ?');
        paramsUpdate.push(supplierId);
      }
      if (supplierName) {
        updates.push('supplier_name = ?');
        paramsUpdate.push(supplierName);
      }
      if (date) {
        const formattedDate = new Date(date).toISOString().slice(0, 19).replace('T', ' ');
        updates.push('date = ?');
        paramsUpdate.push(formattedDate);
      }
      if (deliveryDate !== undefined) {
        updates.push('delivery_date = ?');
        paramsUpdate.push(deliveryDate || null);
      }
      if (finalTotal !== undefined) {
        updates.push('total = ?');
        paramsUpdate.push(finalTotal);
      }
      if (shipping !== undefined) {
        updates.push('shipping_fee = ?');
        paramsUpdate.push(toSafeNumber(shipping));
      }
      if (reference !== undefined) {
        updates.push('reference_number = ?');
        paramsUpdate.push(reference);
      }
      if (paymentMethod) {
        updates.push('payment_method = ?');
        paramsUpdate.push(paymentMethod);
      }
      if (finalVatAmount !== undefined) {
        updates.push('vat_amount = ?');
        paramsUpdate.push(finalVatAmount);
      }

      if (updates.length > 0) {
        sql += updates.join(', ');
        sql += ' WHERE id = ?';
        paramsUpdate.push(id);
        await connection.query(sql, paramsUpdate);
      }

      // 2. Handle Items Update if provided (Full Replace Strategy)
      if (items && Array.isArray(items)) {
        await connection.query('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [id]);
        const insertItemQuery = `
          INSERT INTO purchase_order_items (
            id, purchase_order_id, product_id, product_name, quantity, cost,
            selling_price, discount, discount_type, vat_subject, expiration_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        for (const item of items) {
          const itemId = `poi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await connection.query(insertItemQuery, [
            itemId,
            id,
            item.productId,
            item.productName,
            toSafeNumber(item.quantity),
            toSafeNumber(item.cost),
            item.sellingPrice ? toSafeNumber(item.sellingPrice) : null,
            toSafeNumber(item.discount),
            item.discountType || 'amount',
            item.vatSubject ? 1 : 0,
            item.expirationDate ? new Date(item.expirationDate).toISOString().slice(0, 10) : null
          ]);
        }
      }

      // 3. Handle Receipt Side Effects using helper
      if (status === 'Received' && receivedItems && Array.isArray(receivedItems)) {
        const receiptData = {
          receivedItems,
          receivedTotal: receivedTotal || finalTotal,
          allocationStrategy
        };
        await processPurchaseOrderReceipt(id, receiptData, userId || 'system', connection);
      }

      // 4. Trigger External API Sync (if enabled)
      try {
        const apiConfig = await getExternalApiConfig();
        if (apiConfig.enabled) {
          // Fetch the updated PO for sync
          const [updatedPO]: any = await connection.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
          const [poItems]: any = await connection.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [id]);
          
          if (updatedPO && updatedPO.length > 0) {
            const poData = {
              ...updatedPO[0],
              items: poItems.map((pi: any) => ({
                productId: pi.product_id,
                productName: pi.product_name,
                quantity: pi.quantity,
                cost: pi.cost,
                discount: pi.discount,
                discountType: pi.discount_type,
                vatSubject: pi.vat_subject === 1
              }))
            };

            // Fire and forget sync calls
            syncPurchaseTransaction(id, poData, apiConfig).catch(console.error);
            syncAccountsPayable(poData.supplier_id, apiConfig).catch(console.error);
          }
        }
      } catch (syncError) {
        console.error('Error during external sync trigger:', syncError);
        // We don't fail the transaction if sync fails
      }

      return NextResponse.json({
        success: true,
        message: 'Order updated successfully'
      });
    });
  } catch (error) {
    console.error('Error updating purchase order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update order' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        await query('DELETE FROM purchase_orders WHERE id = ?', [id]);

        return NextResponse.json({
            success: true,
            message: 'Order deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting purchase order:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to delete order' },
            { status: 500 }
        );
    }
}
