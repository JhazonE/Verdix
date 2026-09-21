import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../../../../lib/mysql';

export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json();

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      );
    }

    const result = await withTransaction(async (conn) => {
      // Fetch the order with its items
      const [orders] = await conn.execute(
        `SELECT so.*, c.name as customer_name, c.contact_number, c.sales_area, sp.name as sales_person
         FROM sales_orders so
         JOIN customers c ON so.customer_id = c.id
         LEFT JOIN sales_persons sp ON so.sales_person_id = sp.id
         WHERE so.id = ?`,
        [orderId]
      );

      const order = (orders as any[])[0];
      if (!order) {
        throw new Error('Order not found');
      }

      // An invoice can only be made from a Delivered order, and only once.
      if (order.status !== 'Delivered') {
        throw new Error(`An invoice can only be created from a Delivered order (current status: ${order.status}).`);
      }
      const [existing] = await conn.execute(
        `SELECT id FROM sales_invoices WHERE sales_order_id = ? LIMIT 1`,
        [orderId]
      );
      if ((existing as any[]).length > 0) {
        throw new Error('An invoice has already been created for this sales order.');
      }

      // Fetch order items
      const [items] = await conn.execute(
        `SELECT soi.*, p.name as product_name, p.unit_of_measure
         FROM sales_order_items soi
         LEFT JOIN products p ON soi.product_id = p.id
         WHERE soi.sales_order_id = ?`,
        [orderId]
      );

      // Create invoice record using sales order reference as invoice reference
      const invoiceId = `INV-${uuidv4()}`;
      const invoiceReference = order.reference || `INV-${uuidv4()}`;
      const invoiceDate = new Date().toISOString().split('T')[0];
      const dueDate = order.delivery_date || invoiceDate;

      await conn.execute(
        `INSERT INTO sales_invoices (id, reference, sales_order_id, customer_id, invoice_date, due_date, total, payment_method, sales_person_id, status, transaction_source, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Backoffice', ?, NOW(), NOW())`,
        [
          invoiceId,
          invoiceReference,
          orderId,
          order.customer_id,
          invoiceDate,
          dueDate,
          order.total,
          order.payment_method || 'CASH',
          order.sales_person_id || null,
          'Pending',
          order.notes || '',
        ]
      );

      // Create invoice items. Carry the order line's selling unit forward —
      // sales_order_items already records it — so a later void of this
      // invoice restocks by the right factor instead of assuming base units.
      for (const item of items as any[]) {
        const itemId = `INV-ITEM-${uuidv4()}`;
        await conn.execute(
          `INSERT INTO sales_invoice_items (
             id, sales_invoice_id, product_id, product_name, quantity, price,
             selling_unit_id, selling_unit_name, selling_unit_factor, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            itemId,
            invoiceId,
            item.product_id,
            item.product_name,
            item.quantity,
            item.price,
            item.selling_unit_id ?? null,
            item.selling_unit_name ?? null,
            item.selling_unit_factor ?? null,
          ]
        );
      }

      // Advance the order to Invoiced (also enforces the once-only rule via status)
      await conn.execute("UPDATE sales_orders SET status = 'Invoiced', updated_at = NOW() WHERE id = ?", [orderId]);

      // Return the created invoice as a Sale object
      return {
        success: true,
        data: {
          id: invoiceId,
          customer: {
            id: order.customer_id,
            name: order.customer_name,
            contactNumber: order.contact_number,
            salesArea: order.sales_area,
          },
          invoiceDate,
          reference: invoiceReference,
          items: (items as any[]).map((item: any) => ({
            product: {
              id: item.product_id,
              name: item.product_name,
              unit: item.unit_of_measure || 'pc',
            },
            quantity: Number(item.quantity),
            price: Number(item.price),
          })),
          total: Number(order.total),
          formattedTotal: `₱${Number(order.total).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          paymentMethod: order.payment_method || 'CASH',
          status: 'Pending',
          dueDate,
          salesPerson: order.sales_person || 'N/A',
          notes: order.notes || '',
          shipping: 0,
        },
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Invoice creation error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create invoice' },
      { status: 500 }
    );
  }
}
