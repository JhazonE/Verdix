'use server';

import { query } from '@/lib/mysql';
import { calculatePurchaseCosts, PurchaseItem } from '@/lib/purchase-utils';

/**
 * Server action to fetch purchase order details and calculate costs including landed cost.
 */
export async function getPurchaseCostDetails(orderId: string) {
  try {
    // 1. Fetch Purchase Order
    const poResult = await query(
      'SELECT total, shipping_fee, vat_amount, status FROM purchase_orders WHERE id = ?',
      [orderId]
    );

    if (!poResult || poResult.length === 0) {
      return { success: false, error: 'Purchase order not found' };
    }

    const po = poResult[0];

    // 2. Fetch Items
    const itemsResult = await query(
      `SELECT
        product_id as productId,
        product_name as productName,
        quantity,
        cost,
        discount,
        discount_type as discountType,
        vat_subject as vatSubject,
        selling_unit_factor as sellingUnitFactor
      FROM purchase_order_items
      WHERE purchase_order_id = ?`,
      [orderId]
    );

    const items: PurchaseItem[] = itemsResult.map((item: any) => ({
      ...item,
      vatSubject: item.vatSubject === 1
    }));

    // 3. Calculate using utility
    const calculations = calculatePurchaseCosts(items, parseFloat(po.shipping_fee || '0'));

    return {
      success: true,
      data: {
        orderId,
        status: po.status,
        ...calculations
      }
    };
  } catch (error) {
    console.error('Error fetching purchase cost details:', error);
    return { success: false, error: 'Internal server error' };
  }
}
