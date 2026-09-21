import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../lib/mysql';
import { MySqlSaleRepository } from '../../../src/infrastructure/repositories/MySqlSaleRepository';
import { MySqlCustomerRepository } from '../../../src/infrastructure/repositories/MySqlCustomerRepository';
import { InventorySyncService } from '../../../src/infrastructure/services/InventorySyncService';
import { CreateSaleUseCase } from '../../../src/core/sales/application/CreateSaleUseCase';
import { GetSalesUseCase } from '../../../src/core/sales/application/GetSalesUseCase';

// Initialize dependencies
const saleRepository = new MySqlSaleRepository();
const customerRepository = new MySqlCustomerRepository();
const inventoryService = new InventorySyncService();
const createSaleUseCase = new CreateSaleUseCase(saleRepository, inventoryService);
const getSalesUseCase = new GetSalesUseCase(saleRepository);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const saleId = await createSaleUseCase.execute(body);

    // Fetch the created sale to return it (or just return the response)
    // For consistency with original route.ts, constructing a partial response
    return NextResponse.json({
      success: true,
      message: 'Sales invoice created successfully',
      data: {
        id: saleId,
        customer: body.customer,
        invoiceDate: body.invoiceDate,
        dueDate: body.dueDate,
        total: body.total, // Total is recalculated in Use Case but here we return input or calculate
        paymentMethod: body.paymentMethod,
        status: body.status || 'Pending',
        items: body.items,
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error creating sales invoice:', error);
    if (error.message && error.message.includes('Insufficient stock')) {
      return NextResponse.json(
          { success: false, error: error.message },
          { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: `Failed to create sales invoice: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const countOnly = searchParams.get('countOnly') === 'true';
    const warehouse = searchParams.get('warehouse');

    // Handle countOnly requests (as in original)
    if (countOnly && warehouse) {
      const countQuery = `
        SELECT COUNT(*) as total
        FROM sales_transactions
        WHERE warehouse_id = ?
      `;
      const countResult = await query(countQuery, [warehouse]);
      return NextResponse.json({
        success: true,
        total: countResult[0]?.total || 0,
        timestamp: new Date().toISOString()
      });
    }

    const filters = { warehouse };
    const salesInvoices = await getSalesUseCase.execute(filters);

    // For compliance with frontend expectation, we need to join with customer data 
    // The original route did more joins. I'll supplement the repository data with customer data if needed,
    // but the repository should ideally handle it. For now, let's keep it simple or expand repository.
    
    // Supplement with customer data (Original route joined customers table)
    const customerIds = salesInvoices.map(s => s.customerId).filter(id => id && id !== '');
    let customersMap = new Map();
    if (customerIds.length > 0) {
      const placeholders = customerIds.map(() => '?').join(',');
      const customers: any[] = await query(`SELECT id, name, contact_number, payment_terms FROM customers WHERE id IN (${placeholders})`, customerIds);
      customers.forEach(c => customersMap.set(c.id, c));
    }

    const invoicesWithItems = salesInvoices.map((row: any) => {
      const customer = customersMap.get(row.customerId) || { name: 'Walk-in Customer' };
      return {
        id: row.id,
        reference: row.reference,
        receiptNo: row.receiptNumber,
        transactionSource: row.transactionSource,
        customer: {
          id: row.customerId || '',
          name: customer.name,
          contactNumber: customer.contact_number || '',
          paymentTerms: customer.payment_terms || '',
        },
        invoiceDate: row.invoiceDate,
        dueDate: row.dueDate,
        total: Number(row.total || 0),
        vatAmount: Number(row.vatAmount || 0),
        paymentMethod: row.paymentMethod || '',
        paymentReference: row.paymentReference || '',
        status: row.status,
        notes: row.notes,
        orderNumber: row.orderNumber,
        items: (row.items || []).map((item: any) => ({
          ...item,
          product: {
            id: item.productId,
            name: item.productName || 'Unknown Product',
            sku: item.sku || '',
            barcode: item.barcode || ''
          }
        })),
      };
    });

    return NextResponse.json({
      success: true,
      data: invoicesWithItems,
      count: invoicesWithItems.length,
      source: 'sales_invoices'
    });
  } catch (error: any) {
    console.error('Error fetching sales invoices:', error);
    return NextResponse.json(
      { success: false, error: `Failed to fetch sales invoices: ${error.message}` },
      { status: 500 }
    );
  }
}
