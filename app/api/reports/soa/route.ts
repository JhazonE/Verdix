
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { countableInvoiceSql } from '@/lib/customer-balance';
import { buildSoaLines } from '@/lib/soa-lines';
import { realPaymentSql } from '@/lib/void-refund';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');

    if (!customerId || !fromDate || !toDate) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: customerId, from, to' },
        { status: 400 }
      );
    }

    // 1. Calculate Starting Balance (Transactions before fromDate)
    
    // Sum of previous invoices.
    //
    // This filtered `status != 'Void'` — a value absent from the
    // sales_invoices status enum, which declares 'Voided'. The comparison is
    // therefore TRUE for every genuinely voided invoice, so the filter meant
    // to drop them excluded nothing and the opening balance overstated the
    // debt. Verified in MySQL: for status 'Voided', (status != 'Void') = 1.
    const prevInvoicesSql = `
        SELECT SUM(total) as total
        FROM sales_invoices
        WHERE customer_id = ? AND DATE(invoice_date) < DATE(?) AND ${countableInvoiceSql()}
    `;
    
    const [prevInvResult]: any = await query(prevInvoicesSql, [customerId, fromDate]);
    const prevInvoicesTotal = parseFloat(prevInvResult?.total || 0);

    // Sum of previous payments, LESS whatever of them was applied to an
    // invoice that has since been voided.
    //
    // The opening balance already excludes cancelled invoices (above), so
    // crediting the payments that settled them would open the statement with
    // a phantom credit — a balance reduction for a sale that never happened,
    // understating the debt by the whole payment. A voided invoice and its
    // allocated payments have to fall together; lib/soa-lines applies the
    // same rule to the rows inside the period.
    //
    // An UNALLOCATED payment is untouched: it is money on account, not
    // payment for any particular sale, so a void elsewhere must not swallow
    // it. That is why this subtracts only the matched allocations rather than
    // dropping the whole payment.
    const prevPaymentsSql = `
        SELECT
            COALESCE(SUM(cp.amount), 0) AS total,
            COALESCE((
                SELECT SUM(pa.amount_allocated)
                FROM payment_allocations pa
                JOIN customer_payments cp2 ON cp2.id = pa.payment_id
                JOIN sales_invoices si ON si.id = pa.invoice_id
                WHERE cp2.customer_id = ?
                  AND DATE(cp2.payment_date) < DATE(?)
                  AND ${realPaymentSql('cp2')}
                  AND NOT (${countableInvoiceSql('si')})
            ), 0) AS allocatedToVoided
        FROM customer_payments cp
        WHERE cp.customer_id = ? AND DATE(cp.payment_date) < DATE(?) AND ${realPaymentSql('cp')}
    `;
    let prevPaymentsTotal = 0;
    try {
      const [prevPayResult]: any = await query(prevPaymentsSql, [
        customerId, fromDate, customerId, fromDate,
      ]);
      const gross = parseFloat(prevPayResult?.total || 0);
      const voidedPart = parseFloat(prevPayResult?.allocatedToVoided || 0);
      prevPaymentsTotal = gross - voidedPart;
    } catch {
      // payment_allocations may not exist yet on a fresh DB. Fall back to the
      // gross figure rather than failing the statement: with no allocation
      // table there is nothing allocated to a voided invoice anyway.
      const [fallback]: any = await query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM customer_payments
         WHERE customer_id = ? AND DATE(payment_date) < DATE(?) AND ${realPaymentSql()}`,
        [customerId, fromDate]
      );
      prevPaymentsTotal = parseFloat(fallback?.total || 0);
    }

    const startingBalance = prevInvoicesTotal - prevPaymentsTotal;

    // 2. Fetch Transactions within range

    // Invoices
    const invoicesSql = `
        SELECT
            id,
            reference,
            invoice_date as date,
            due_date as dueDate,
            'Invoice' as type,
            total as amount,
            amount_paid as amountPaid,
            0 as credit,
            status,
            notes as description
        FROM sales_invoices
        WHERE customer_id = ? AND DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
    `;
    // No status filter here on purpose: voided invoices are DISPLAYED on the
    // statement, marked as void, and it is lib/soa-lines that zeroes their
    // effect on the balance. A customer who was handed an invoice and later
    // had it cancelled should see that cancellation rather than be left with
    // a document number that has no counterpart on their statement.
    const invoices: any[] = await query(invoicesSql, [customerId, fromDate, toDate]);

    // Payments (one row per payment; lib/soa-lines expands the allocations).
    //
    // Voiding an invoice (app/api/sales/invoices/[id]/void/route.ts) reverses
    // stock and flips the status, but leaves the customer_payments rows and
    // the payment_allocations that pointed at it in place. The statement
    // therefore has to pair them itself: a payment allocated to a voided
    // invoice credits nothing, because crediting it while the invoice counts
    // zero would reduce the balance for a sale that never happened. An
    // unallocated payment is untouched — money on account, not payment for
    // the cancelled sale. buildSoaLines owns that rule.
    const paymentsSql = `
        SELECT
            cp.id,
            cp.reference,
            cp.payment_date as date,
            cp.payment_type as type,
            -- Plain cp.amount: the WHERE below already excludes the
            -- non-payment types (CHARGE, REFUND), so the CASE that used to
            -- zero a CHARGE row here could never match and only suggested
            -- such rows might arrive.
            cp.amount as credit,
            cp.note
        FROM customer_payments cp
        WHERE cp.customer_id = ? AND DATE(cp.payment_date) BETWEEN DATE(?) AND DATE(?)
          AND ${realPaymentSql('cp')}
    `;
    const payments: any[] = await query(paymentsSql, [customerId, fromDate, toDate]);

    // Read real allocation links from the junction table (source of truth).
    const paymentIds = payments.map(p => p.id);
    let allocationsByPayment = new Map<string, any[]>();
    if (paymentIds.length > 0) {
        const placeholders = paymentIds.map(() => '?').join(',');
        const allocationsSql = `
            SELECT pa.payment_id, pa.invoice_id, pa.amount_allocated, si.reference as invoice_ref
            FROM payment_allocations pa
            LEFT JOIN sales_invoices si ON si.id = pa.invoice_id
            WHERE pa.payment_id IN (${placeholders})
        `;
        try {
            const allocationRows: any[] = await query(allocationsSql, paymentIds);
            for (const row of allocationRows) {
                const list = allocationsByPayment.get(row.payment_id) || [];
                list.push(row);
                allocationsByPayment.set(row.payment_id, list);
            }
        } catch (e) {
            // payment_allocations table may not exist yet on a fresh DB — treat all payments as unallocated.
            allocationsByPayment = new Map();
        }
    }

    // 3. Build the lines and the running balance.
    //
    // All the arithmetic — including what a voided invoice and its payments
    // count for — lives in lib/soa-lines, so it is unit-testable without a
    // database (tests/unit/soa-voided-invoices).
    const built = buildSoaLines({
      openingBalance: startingBalance,
      invoices: invoices.map((inv: any) => ({
        id: inv.id,
        reference: inv.reference,
        date: inv.date,
        dueDate: inv.dueDate,
        total: inv.amount,
        amountPaid: inv.amountPaid,
        status: inv.status,
        description: inv.description,
      })),
      payments: payments.map((pay: any) => ({
        id: pay.id,
        reference: pay.reference,
        date: pay.date,
        type: pay.type,
        amount: pay.credit,
        note: pay.note,
        allocations: (allocationsByPayment.get(pay.id) || []).map((a: any) => ({
          invoiceId: a.invoice_id,
          amount: a.amount_allocated,
          invoiceRef: a.invoice_ref,
        })),
      })),
    });

    return NextResponse.json({
      success: true,
      data: {
        customerId,
        period: { from: fromDate, to: toDate },
        startingBalance: built.openingBalance,
        endingBalance: built.closingBalance,
        totalDebit: built.totalDebit,
        totalCredit: built.totalCredit,
        // `invoice_ref` is kept as an alias so the page's existing grouping
        // (which reads it) keeps working.
        transactions: built.lines.map((line) => ({
          ...line,
          invoice_ref: line.invoiceRef ?? null,
        })),
      }
    });

  } catch (error) {
    console.error('Error generating SOA:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate Statement of Account' },
      { status: 500 }
    );
  }
}
