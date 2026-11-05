import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { v4 as uuidv4 } from 'uuid';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';
import { planAllocations, type InvoiceState } from '@/lib/payment-allocation';
import { nextPaymentReference } from '@/lib/payment-reference';

// Ensure the junction table that links a payment to the invoice(s) it was applied to.
// This is the source of truth for allocation tracking (replaces fragile note-string parsing).
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customerId, paymentType, paymentDate, amount, reference, note, allocations } = body;

    // Validate required fields
    if (!customerId || !paymentType || !paymentDate || !amount) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    await ensurePaymentAllocationsTable();
    // The unallocated remainder becomes account credit, so the column must
    // exist before the transaction opens. It is created by
    // lib/ensure-customer-credit, not by a migration.
    await ensureCustomerCreditColumn();

    return await withTransaction(async (connection) => {
        // Check if customer exists
        const [customerCheck]: any = await connection.query(
          'SELECT id FROM customers WHERE id = ?',
          [customerId]
        );

        if (!customerCheck || customerCheck.length === 0) {
          throw new Error('Customer not found');
        }

        // Insert the payment, allocating its reference as part of the insert.
        //
        // The reference used to be derived with `MAX(...) + 1` and inserted
        // without a retry. reference carries a UNIQUE index and this database
        // runs at REPEATABLE-READ, where that aggregate takes no lock, so two
        // cashiers recording a payment at the same moment computed the same
        // number and the loser's insert failed with ER_DUP_ENTRY — the
        // customer had paid and nothing was recorded. Reproduced against this
        // schema: both actors computed '000006'; the second insert failed.
        // nextPaymentReference retries past the taken number instead.
        const paymentId = uuidv4();
        const finalReference = await nextPaymentReference(
          connection,
          reference,
          async (ref) => {
            await connection.query(
              `INSERT INTO customer_payments (
                id, customer_id, payment_type, payment_date, amount, reference, note
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [paymentId, customerId, paymentType, new Date(paymentDate), amount, ref, note]
            );
          }
        );

        // Work out the split before writing anything, so the arithmetic is
        // testable without a database (see tests/unit/payment-allocation).
        const requests = Array.isArray(allocations) ? allocations : [];

        // Lock the named invoices in id order, in ONE statement. Locking them
        // up front and ordered is the project's established rule for avoiding
        // deadlocks between concurrent writers (see the checkout route, which
        // locks products the same way); taking the locks one at a time inside
        // the loop lets two payments that name the same two invoices in
        // opposite orders deadlock.
        const invoiceIds = Array.from(
            new Set(
                requests
                    .filter((a: any) => Number(a?.amountAllocated) > 0)
                    .map((a: any) => a.invoiceId)
                    .filter(Boolean)
            )
        ).sort();

        const invoiceStates = new Map<string, InvoiceState>();
        if (invoiceIds.length > 0) {
            const placeholders = invoiceIds.map(() => '?').join(',');
            const [rows]: any = await connection.query(
                `SELECT id, total, amount_paid FROM sales_invoices
                 WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`,
                invoiceIds
            );
            for (const row of rows || []) {
                invoiceStates.set(row.id, {
                    invoiceId: row.id,
                    total: Number(row.total),
                    amountPaid: Number(row.amount_paid || 0),
                });
            }
        }

        const plan = planAllocations(Number(amount), requests, invoiceStates);

        for (const applied of plan.applied) {
            await connection.query(
                `UPDATE sales_invoices
                 SET amount_paid = ?, status = ?, updated_at = NOW()
                 WHERE id = ?`,
                [applied.newAmountPaid, applied.newStatus, applied.invoiceId]
            );

            // Record the allocation link (audit trail / source of truth).
            await connection.query(
                `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_allocated)
                 VALUES (?, ?, ?, ?)`,
                [uuidv4(), paymentId, applied.invoiceId, applied.appliedAmount]
            );
        }

        // Whatever no invoice took becomes available account credit.
        //
        // This is the fix for the money that used to disappear: the old loop
        // tracked the remainder in a local variable and then never read it
        // after the loop, so an overpayment was recorded in
        // customer_payments.amount but never added to credit_balance. Customer
        // Balances nets outstanding invoices against credit_balance, so the
        // excess was invisible there — the payment showed as "Unallocated" in
        // Payment History while doing nothing to reduce what the customer
        // owed. The sibling route app/api/customers/payments already did this.
        if (plan.unallocated > 0) {
            await connection.query(
                'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, updated_at = NOW() WHERE id = ?',
                [plan.unallocated, customerId]
            );
        }

        return NextResponse.json({
          success: true,
          message: 'Payment added successfully',
          data: {
            id: paymentId,
            customerId,
            paymentType,
            paymentDate,
            amount,
            // The reference ACTUALLY written, not the caller's input. The
            // dialog reports this back to the cashier ("Reference: ..."), and
            // for an auto-generated reference the input is undefined, so
            // echoing it left the toast with a blank number.
            reference: finalReference,
            note,
            allocations: plan.applied,
            // So the UI can tell the cashier an overpayment was kept on file
            // rather than silently banked.
            creditAdded: plan.unallocated,
          },
        });
    });
  } catch (error: any) {
    console.error('Error adding customer payment:', error);
    return NextResponse.json(
      { success: false, error: error.message || String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');

    let sql = `
      SELECT
        cp.*,
        c.name as customer_name,
        c.contact_number
      FROM customer_payments cp
      JOIN customers c ON cp.customer_id = c.id
    `;

    const params: any[] = [];

    if (customerId) {
      sql += ' WHERE cp.customer_id = ?';
      params.push(customerId);
    }

    sql += ' ORDER BY cp.payment_date DESC, cp.created_at DESC';

    const payments = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.error('Error fetching customer payments:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
