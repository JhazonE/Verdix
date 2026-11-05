
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { countableInvoiceSql } from '@/lib/customer-balance';

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

    // Sum of previous payments
    const prevPaymentsSql = `
        SELECT SUM(amount) as total
        FROM customer_payments
        WHERE customer_id = ? AND DATE(payment_date) < DATE(?) AND UPPER(payment_type) != 'CHARGE'
    `;
    const [prevPayResult]: any = await query(prevPaymentsSql, [customerId, fromDate]);
    const prevPaymentsTotal = parseFloat(prevPayResult?.total || 0);

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
        WHERE customer_id = ? AND DATE(invoice_date) BETWEEN DATE(?) AND DATE(?) AND ${countableInvoiceSql()}
    `;
    const invoices: any[] = await query(invoicesSql, [customerId, fromDate, toDate]);

    // Payments (one row per payment; allocations are expanded below).
    //
    // KNOWN GAP, deliberately not changed here: voiding an invoice
    // (app/api/sales/invoices/[id]/void/route.ts) reverses stock and flips the
    // status, but does NOT reverse the customer_payments rows or the
    // payment_allocations that pointed at it. Now that the invoice correctly
    // drops out of the debit side above, a payment collected against an
    // invoice later voided would still appear as a credit — a refund that is
    // real money the customer handed over, so silently hiding it would be
    // worse than showing it. Verified on the live DB: zero allocations
    // currently point at a cancelled invoice, so nothing is misreported
    // today. Fixing it properly means deciding whether a void refunds to
    // account credit or to cash, which is a product decision, not a query fix.
    const paymentsSql = `
        SELECT
            cp.id,
            cp.reference,
            cp.payment_date as date,
            cp.payment_type as type,
            CASE WHEN UPPER(cp.payment_type) = 'CHARGE' THEN 0 ELSE cp.amount END as credit,
            cp.note
        FROM customer_payments cp
        WHERE cp.customer_id = ? AND DATE(cp.payment_date) BETWEEN DATE(?) AND DATE(?)
          AND UPPER(cp.payment_type) != 'CHARGE'
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

    // Expand each payment into credit lines: one per allocation, plus any unallocated remainder.
    const paymentLines = payments.flatMap(pay => {
        const credit = parseFloat(pay.credit);
        const allocs = allocationsByPayment.get(pay.id) || [];

        if (allocs.length === 0 || credit === 0) {
            return [{
                ...pay,
                type: 'Payment',
                description: `Payment${pay.reference ? ` (Ref: ${pay.reference})` : ''}`,
                allocatedInvoiceId: null,
                invoice_ref: null,
                debit: 0,
                credit,
            }];
        }

        const lines = allocs.map(a => ({
            id: `${pay.id}__${a.invoice_id}`,
            reference: pay.reference,
            date: pay.date,
            type: 'Payment',
            note: pay.note,
            description: `Payment - Invoice #${a.invoice_ref || a.invoice_id}${pay.reference ? ` (Ref: ${pay.reference})` : ''}`,
            allocatedInvoiceId: a.invoice_id,
            invoice_ref: a.invoice_ref,
            debit: 0,
            credit: parseFloat(a.amount_allocated),
        }));

        // Any portion of the payment not allocated to an invoice shows as an unallocated credit.
        const allocatedTotal = allocs.reduce((sum, a) => sum + parseFloat(a.amount_allocated), 0);
        const remainder = credit - allocatedTotal;
        if (remainder > 0.005) {
            lines.push({
                id: `${pay.id}__unallocated`,
                reference: pay.reference,
                date: pay.date,
                type: 'Payment',
                note: pay.note,
                description: `Payment${pay.reference ? ` (Ref: ${pay.reference})` : ''}`,
                allocatedInvoiceId: null,
                invoice_ref: null,
                debit: 0,
                credit: remainder,
            });
        }
        return lines;
    });

    // 3. Combine and Sort
    const transactions = [
        ...invoices.map(inv => ({ ...inv, debit: parseFloat(inv.amount), amountPaid: parseFloat(inv.amountPaid || 0), credit: 0 })),
        ...paymentLines
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 4. Calculate Running Balance
    let currentBalance = startingBalance;
    const soaData = transactions.map(t => {
        currentBalance += (t.debit - t.credit);
        return {
            ...t,
            runningBalance: currentBalance
        };
    });

    return NextResponse.json({
      success: true,
      data: {
        customerId,
        period: { from: fromDate, to: toDate },
        startingBalance,
        endingBalance: currentBalance,
        transactions: soaData
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
