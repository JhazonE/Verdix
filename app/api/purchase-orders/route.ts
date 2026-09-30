import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '../../../lib/mysql';
import { getExternalApiConfig } from '../../../lib/external-api-config';
import { syncPurchaseTransaction } from '../../../lib/services/external-accounting-api';
import { calculatePurchaseCosts } from '../../../lib/purchase-utils';
import { toSafeNumber } from '../../../lib/utils';
import { processPurchaseOrderCreation } from '../../../lib/purchase-actions';
import { checkApprovalRequired, submitToApprovalQueue } from '../../../lib/approvals';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const supplierId = searchParams.get('supplierId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let sql = `
      SELECT
        po.id,
        po.supplier_id,
        po.supplier_name,
        po.date,
        po.total,
        po.payment_method,
        po.status,
        po.created_at,
        po.updated_at,
        po.ordered_by,
        po.shipping_fee,
        po.vat_amount,
        po.delivery_date,
        po.delivery_date,
        po.received_total,
        po.reference_number,
        po.warehouse_id,
        po.warehouse_name
      FROM purchase_orders po
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND po.status = ?';
      params.push(status);
    }

    if (supplierId) {
      sql += ' AND po.supplier_id = ?';
      params.push(supplierId);
    }

    if (search) {
      sql += ' AND (po.id LIKE ? OR po.supplier_name LIKE ? OR po.reference_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (startDate) {
      sql += ' AND po.date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND po.date <= ?';
      params.push(`${endDate} 23:59:59`);
    }

    sql += ' ORDER BY po.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const purchaseOrders = await query(sql, params);

    // Fetch items for each order
    const ordersWithItems = await Promise.all(
      purchaseOrders.map(async (row: any) => {
        const itemsQuery = `
          SELECT
            poi.id,
            poi.product_id,
            poi.product_name,
            poi.quantity,
            poi.cost,
            poi.selling_price,
            poi.discount,
            poi.discount_type,
            poi.vat_subject,
            poi.selling_unit_id,
            poi.selling_unit_name,
            poi.selling_unit_factor,
            p.barcode,
            p.stock as current_stock,
            poi.subtotal
          FROM purchase_order_items poi
          LEFT JOIN products p ON poi.product_id = p.id
          WHERE poi.purchase_order_id = ?
          ORDER BY poi.created_at ASC
        `;

        const items = await query(itemsQuery, [row.id]);

        return {
          id: row.id,
          supplierId: row.supplier_id,
          supplierName: row.supplier_name,
          date: row.date,
          total: toSafeNumber(row.total),
          paymentMethod: row.payment_method || '',
          status: row.status,
          // New tracking fields
          orderedBy: row.ordered_by || '',
          shippingFee: toSafeNumber(row.shipping_fee),
          vatAmount: toSafeNumber(row.vat_amount),
          deliveryDate: row.delivery_date ? row.delivery_date : undefined,
          receivedTotal: toSafeNumber(row.received_total),
          referenceNumber: row.reference_number || '',
          warehouseId: row.warehouse_id || undefined,
          warehouseName: row.warehouse_name || undefined,
          items: items.map((item: any) => ({
            id: item.id,
            productId: item.product_id,
            productName: item.product_name,
            quantity: toSafeNumber(item.quantity),
            cost: toSafeNumber(item.cost),
            sellingPrice: item.selling_price ? toSafeNumber(item.selling_price) : undefined,
            discount: item.discount ? toSafeNumber(item.discount) : 0,
            discountType: item.discount_type || 'amount',
            vatSubject: item.vat_subject === 1,
            barcode: item.barcode || undefined,
            currentStock: toSafeNumber(item.current_stock),
            sellingUnitId: item.selling_unit_id || undefined,
            sellingUnitName: item.selling_unit_name || undefined,
            sellingUnitFactor: item.selling_unit_factor ? toSafeNumber(item.selling_unit_factor) : undefined,
          })),
        };
      })
    );

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM purchase_orders po WHERE 1=1';
    const countParams: any[] = [];

    if (status) {
      countSql += ' AND po.status = ?';
      countParams.push(status);
    }

    if (supplierId) {
      countSql += ' AND po.supplier_id = ?';
      countParams.push(supplierId);
    }

    if (search) {
      countSql += ' AND (po.id LIKE ? OR po.supplier_name LIKE ? OR po.reference_number LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (startDate) {
      countSql += ' AND po.date >= ?';
      countParams.push(startDate);
    }

    if (endDate) {
      countSql += ' AND po.date <= ?';
      countParams.push(`${endDate} 23:59:59`);
    }

    const countResult = await query(countSql, countParams);
    const total = countResult[0]?.total || 0;

    return NextResponse.json({
      success: true,
      data: ordersWithItems,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch purchase orders' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
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
      isInternalFinalization
    } = body;

    if (!supplierId || !supplierName || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    const formattedDate = new Date(date || new Date()).toISOString().slice(0, 19).replace('T', ' ');
    const calculations = calculatePurchaseCosts(items, shipping || 0);
    const finalTotal = calculations.grandTotal;
    const finalVatAmount = calculations.vatAmount;

    // 1. Check for multi-level approval
    const orderId = `po_${Date.now()}`;
    const txData = { ...body, id: orderId };
    const approvalType = purchaseType === 'Receive' ? 'RECEIVE_PO' : 'PURCHASE_ORDER';
    const isApprovalRequired = !isInternalFinalization && await checkApprovalRequired(approvalType);
    
    if (isApprovalRequired) {
      const userId = body.userId || 'system';
      
      // Create the record in DB immediately with 'Pending' status so it shows in the table
      await processPurchaseOrderCreation({ ...txData, status: 'Pending' }, userId);
      
      const { queueId, pendingApproval } = await submitToApprovalQueue(approvalType, txData, userId);
      
      if (pendingApproval) {
        return NextResponse.json({
          success: true,
          pendingApproval: true,
          data: { queueId, orderId },
          message: `${approvalType === 'RECEIVE_PO' ? 'Purchase receipt' : 'Purchase order'} submitted for approval and added as Pending.`
        });
      }
      
      // If not pending (all steps auto-skipped), mark as finalized
      txData.isInternalFinalization = true;
    }

    // Use helper for creation (or finalization if approval was skipped or not required)
    const result = await processPurchaseOrderCreation(txData);
    const finalOrderId = (result as any).orderId;

    // Sync to external accounting API (non-blocking)
    try {
      const apiConfig = await getExternalApiConfig();
      if (apiConfig.enabled) {
        const purchaseOrderData = {
          id: orderId,
          supplierId,
          supplierName,
          date: formattedDate,
          deliveryDate: body.deliveryDate || null,
          total: finalTotal || 0,
          vatAmount: finalVatAmount || 0,
          shippingFee: toSafeNumber(shipping),
          paymentMethod: paymentMethod || '',
          status: (purchaseType === 'Receive') ? 'Received' : (status || 'Pending'),
          orderedBy: orderedBy || '',
          referenceNumber: reference || '',
          items,
        };
        
        // Fire and forget - don't wait for external API
        syncPurchaseTransaction(orderId, purchaseOrderData, apiConfig).catch(err => {
          console.error('External API sync failed (non-blocking):', err);
        });
      }
    } catch (error) {
      // Log but don't fail the purchase order creation
      console.error('Error triggering external API sync:', error);
    }

    return NextResponse.json({
      success: true,
      data: { id: orderId },
      message: 'Purchase order created successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating purchase order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create purchase order' },
      { status: 500 }
    );
  }
}
