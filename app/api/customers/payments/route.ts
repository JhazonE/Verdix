
import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';
import { v4 as uuidv4 } from 'uuid';

// Ensure the allocation junction table exists so JOINs below never fail on a fresh DB.
async function ensurePaymentAllocationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id VARCHAR(255) PRIMARY KEY,
      payment_id VARCHAR(255) NOT NULL,
      invoice_id VARCHAR(255) NOT NULL,
      amount_allocated DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_payment_id (payment_id),
      INDEX idx_invoice_id (invoice_id),
      CONSTRAINT fk_pa_payment FOREIGN KEY (payment_id) REFERENCES customer_payments(id) ON DELETE CASCADE
    )
  `);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const paymentType = searchParams.get('paymentType');
    const customerId = searchParams.get('customerId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const page = parseInt(searchParams.get('page') || '1');
    const offset = (page - 1) * limit;

    await ensurePaymentAllocationsTable();

    let sql = `
      SELECT
        cp.id,
        cp.customer_id,
        c.name as customer_name,
        cp.payment_type,
        cp.payment_date,
        cp.amount,
        cp.reference,
        cp.note,
        cp.created_at,
        COALESCE(pa.total_allocated, 0) as total_allocated
      FROM customer_payments cp
      LEFT JOIN customers c ON cp.customer_id = c.id
      LEFT JOIN (
        SELECT payment_id, SUM(amount_allocated) as total_allocated
        FROM payment_allocations
        GROUP BY payment_id
      ) pa ON pa.payment_id = cp.id
      WHERE UPPER(cp.payment_type) != 'CHARGE'
    `;

    const params: any[] = [];

    if (search) {
      sql += ' AND (c.name LIKE ? OR cp.reference LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (fromDate) {
        sql += ' AND DATE(cp.payment_date) >= DATE(?)';
        params.push(fromDate);
    }

    if (toDate) {
        sql += ' AND DATE(cp.payment_date) <= DATE(?)';
        params.push(toDate);
    }

    if (paymentType && paymentType !== 'All') {
        sql += ' AND cp.payment_type = ?';
        params.push(paymentType);
    }

    if (customerId) {
        sql += ' AND cp.customer_id = ?';
        params.push(customerId);
    }

    // Get total count for pagination
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) as sub`;
    const countResult = await query(countSql, params);
    const total = countResult[0]?.total || 0;

    sql += ' ORDER BY cp.payment_date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const payments = await query(sql, params);

    // Format for frontend
    const formattedPayments = payments.map((row: any) => {
      const amount = parseFloat(row.amount);
      const allocated = parseFloat(row.total_allocated || 0);
      const leftToAllocate = Math.max(0, amount - allocated);
      return {
        id: row.id,
        customerName: row.customer_name || 'Unknown Customer',
        amount,
        allocated,
        leftToAllocate,
        allocationStatus: allocated <= 0 ? 'Unallocated' : leftToAllocate > 0 ? 'Partial' : 'Allocated',
        paymentType: row.payment_type,
        paymentDate: row.payment_date,
        reference: row.reference,
        note: row.note,
      };
    });

    return NextResponse.json({
      success: true,
      data: formattedPayments,
      pagination: {
        total,
        limit,
        page,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching customer payments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch customer payments' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { customerId, amount, appliedAmount, paymentType, paymentDate, reference, note, invoiceNo } = data;

    // Amount applied to the invoice may be less than the recorded payment when the
    // customer overpays and keeps the excess as account credit. Falls back to the
    // full amount for backward compatibility.
    const invoiceApplied = (appliedAmount !== undefined && appliedAmount !== null) ? appliedAmount : amount;

    if (!customerId || !amount || !paymentType) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const finalReference = reference || `PAY-${Date.now()}`;
    const formattedDate = paymentDate ? new Date(paymentDate).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');

    // The portion of the recorded payment NOT applied to the invoice becomes
    // available account credit (e.g. an overpayment the customer keeps on file).
    const creditDelta = Math.max(0, Number(amount) - Number(invoiceApplied));
    if (creditDelta > 0) await ensureCustomerCreditColumn();

    // Junction table must exist before we link this payment to its invoice.
    if (invoiceNo) await ensurePaymentAllocationsTable();

    return await withTransaction(async (connection) => {
      // 1. Record the payment
      const insertSql = `
        INSERT INTO customer_payments (id, customer_id, payment_type, payment_date, amount, reference, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      await connection.query(insertSql, [id, customerId, paymentType, formattedDate, amount, finalReference, note || null]);

      // 2. If it's for a specific invoice, update that invoice's paid amount and status
      if (invoiceNo) {
        // Update sales_invoices amount_paid and status in one go if possible, 
        // but since we need to compare amount_paid and total, doing it in steps is safer.
        
        // Step A: Update amount_paid
        await connection.query(`
          UPDATE sales_invoices
          SET amount_paid = COALESCE(amount_paid, 0) + ?,
              updated_at = NOW()
          WHERE reference = ?
        `, [invoiceApplied, invoiceNo]);

        // Step B: Update status based on total. 'Partially Paid' is the enum member
        // these columns actually declare — writing 'Partial' is truncated, and under
        // STRICT_TRANS_TABLES that error aborts the whole payment transaction, so a
        // part-payment of a charge used to fail outright instead of being recorded.
        await connection.query(`
          UPDATE sales_invoices
          SET status = CASE
                WHEN amount_paid >= total THEN 'Paid'
                WHEN amount_paid > 0 THEN 'Partially Paid'
                ELSE 'Pending'
              END,
              updated_at = NOW()
          WHERE reference = ?
        `, [invoiceNo]);

        // Step C: Sync to sales_transactions
        await connection.query(`
          UPDATE sales_transactions st
          JOIN sales_invoices si ON st.reference = si.reference
          SET st.status = si.status,
              st.updated_at = NOW()
          WHERE st.reference = ?
        `, [invoiceNo]);

        // Step D: Record the allocation link (source of truth for allocation status /
        // SOA). Without this the payment shows as "Unallocated" even though it was
        // applied to a specific invoice. invoiceNo is the human-readable reference;
        // payment_allocations stores the internal invoice id.
        const [invRows]: any = await connection.query(
          'SELECT id FROM sales_invoices WHERE reference = ? AND customer_id = ? LIMIT 1',
          [invoiceNo, customerId]
        );
        const invoiceId = invRows && invRows.length > 0 ? invRows[0].id : null;
        if (invoiceId) {
          const allocationId = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          await connection.query(
            `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_allocated)
             VALUES (?, ?, ?, ?)`,
            [allocationId, id, invoiceId, invoiceApplied]
          );
        }
      }

      // Credit the customer's account with any unapplied overpayment.
      if (creditDelta > 0) {
        await connection.query(
          'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, updated_at = NOW() WHERE id = ?',
          [creditDelta, customerId]
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Payment recorded successfully',
        data: { id, customerId, amount, paymentType, paymentDate: formattedDate, reference: finalReference, note }
      });
    });
  } catch (error: any) {
    console.error('Error creating customer payment:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to record payment' },
      { status: 500 }
    );
  }
}
