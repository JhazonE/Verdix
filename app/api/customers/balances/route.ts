
import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../lib/mysql';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';
import { openInvoiceSql } from '@/lib/customer-balance';

export async function GET(request: NextRequest) {
  try {
    await ensureCustomerCreditColumn();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');

    // Net balance = outstanding invoices minus any available account credit.
    //
    // "Outstanding" comes from lib/customer-balance so this route, the customer
    // detail route and the SOA cannot disagree. This used to filter only
    // `status != 'Paid'`, which left voided and returned invoices on the
    // customer's balance forever: voiding an invoice writes status 'Voided',
    // never 'Paid', so the row went on being counted as debt.
    let sql = `
      SELECT
        c.id,
        c.name,
        c.contact_number AS contactNumber,
        c.payment_terms AS paymentTerms,
        COALESCE(c.credit_balance, 0) AS creditBalance,
        COUNT(si.id) AS invoiceCount,
        SUM(si.total - COALESCE(si.amount_paid, 0)) - COALESCE(c.credit_balance, 0) AS balance
      FROM customers c
      JOIN sales_invoices si ON c.id = si.customer_id
      WHERE ${openInvoiceSql('si')}
    `;

    const params: any[] = [];

    if (search) {
      sql += ' AND (c.name LIKE ? OR c.contact_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += `
      GROUP BY c.id, c.name, c.contact_number, c.payment_terms, c.credit_balance
      ORDER BY balance DESC
    `;

    const customersWithBalances = await query(sql, params);

    return NextResponse.json({
      success: true,
      data: customersWithBalances,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching customer balances:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch customer balances' },
      { status: 500 }
    );
  }
}
