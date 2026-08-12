import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../lib/mysql';

async function getLastReference(tableName: string, orderByColumn: string = 'created_at', referenceColumn: string = 'reference'): Promise<string | null> {
  try {
    const result = await query(`
      SELECT ${referenceColumn} AS reference
      FROM ${tableName}
      WHERE ${referenceColumn} IS NOT NULL AND ${referenceColumn} != ''
      ORDER BY ${orderByColumn} DESC
      LIMIT 1
    `);
    return result[0]?.reference || null;
  } catch (error) {
    // Table might not exist or have reference column
    console.log(`Could not fetch last reference from ${tableName}:`, error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Fetch last used reference for each transaction type
    const [
      lastSalesOrder,
      lastSalesInvoice,
      lastPurchaseOrder,
      lastCustomerPayment,
      lastStockAdjustment
    ] = await Promise.all([
      getLastReference('sales_orders'),
      getLastReference('sales_invoices', 'invoice_date'),
      getLastReference('purchase_orders', 'date', 'reference_number'),
      getLastReference('customer_payments', 'payment_date'),
      getLastReference('stock_adjustments', 'created_at', 'reference_no'),
    ]);

    const lastReferences = {
      salesOrder: lastSalesOrder,
      purchaseOrder: lastPurchaseOrder,
      salesDelivery: null, // Add when table exists
      paymentToSupplier: null, // Add when table exists
      salesInvoice: lastSalesInvoice,
      customerPayment: lastCustomerPayment,
      deliveryReceipt: null, // Add when table exists
      stockAdjustment: lastStockAdjustment,
      salesHold: null, // Add when table exists
    };

    return NextResponse.json({
      success: true,
      data: lastReferences,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching last transaction references:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch last transaction references',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
