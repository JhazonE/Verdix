import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { formatSINumber } from '@/lib/si-number';

// voided_by_name is added lazily by /api/pos/void-transaction — this report can be
// the first thing to run against a fresh DB, so it can't assume the column exists.
let voidedByColumnChecked = false;
let hasVoidedByColumn = false;
async function checkVoidedByColumn() {
  if (voidedByColumnChecked) return hasVoidedByColumn;
  const cols = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sales_transactions' AND COLUMN_NAME = 'voided_by_name' AND TABLE_SCHEMA = DATABASE()"
  ) as any[];
  hasVoidedByColumn = cols.length > 0;
  voidedByColumnChecked = true;
  return hasVoidedByColumn;
}

export async function GET(request: NextRequest) {
  try {
    const hasVoidedBy = await checkVoidedByColumn();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate'); // yyyy-MM-dd
    const endDate = searchParams.get('endDate');     // yyyy-MM-dd

    let sql = `
      SELECT 
        pt.id as pos_transaction_id,
        pt.order_number,
        COALESCE(pt.si_number, st.si_number) as si_number,
        st.id as sale_id,
        DATE(st.created_at) as trans_date,
        COALESCE(c.name, 'Walk-in Customer') as customer_name,
        u_cashier.display_name as cashier_name,
        st.updated_at as void_date,
        ${hasVoidedBy ? 'COALESCE(st.voided_by_name, u_cashier.display_name)' : 'u_cashier.display_name'} as voided_by,
        ${hasVoidedBy ? 'COALESCE(st.voided_by_name, u_cashier.display_name)' : 'u_cashier.display_name'} as override_by,
        st.total as sales_amount,
        COALESCE(pt.tax_amount, 0) as vat_amount,
        st.notes as note,
        (
          SELECT COALESCE(SUM(p.cost * si.quantity), 0)
          FROM sale_items si
          LEFT JOIN products p ON si.product_id = p.id
          WHERE si.sale_id = st.id
        ) as total_cost
      FROM sales_transactions st
      LEFT JOIN pos_transactions pt ON pt.sale_id = st.id
      LEFT JOIN customers c ON st.customer_id = c.id
      LEFT JOIN users u_cashier ON pt.user_id = u_cashier.uid
      WHERE st.status = 'Voided'
    `;

    const params: any[] = [];

    // Filter by VOID date (st.updated_at) — i.e. when the transaction was voided,
    // not when the sale was originally made. Range is kept sargable (no DATE()
    // wrapper on the column) so it can use an index, and the end date is made
    // inclusive of the whole day via < endDate + 1 day.
    if (startDate) {
      sql += ' AND st.updated_at >= ?';
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      sql += ' AND st.updated_at < DATE_ADD(?, INTERVAL 1 DAY)';
      params.push(endDate);
    }

    sql += ' ORDER BY st.updated_at DESC';

    const results = await query(sql, params);

    // Transform results with profit calculation
    const data = (results as any[]).map((row: any) => {
      const salesAmount = parseFloat(row.sales_amount) || 0;
      const totalCost = parseFloat(row.total_cost) || 0;
      const vatAmount = parseFloat(row.vat_amount) || 0;
      const profit = salesAmount - totalCost;
      // Vatable sales: sales amount minus VAT (VAT inclusive calculation)
      const vatableSales = salesAmount - vatAmount;

      return {
        // Primary identifier is the real SI number of the voided sale.
        refNo: `SI No. ${row.si_number ? formatSINumber(row.si_number) : (row.order_number ?? 'N/A')}`,
        siNo: '',
        transDate: row.trans_date,
        customer: row.customer_name,
        cashier: row.cashier_name || 'admin',
        voidDate: row.void_date,
        voidedBy: row.voided_by || 'admin',
        overrideBy: row.override_by || 'admin',
        salesAmount: salesAmount,
        cost: totalCost,
        profit: profit,
        vatableSales: vatableSales,
        vatAmount: vatAmount,
        note: row.note || ''
      };
    });

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error: any) {
    console.error('Error fetching voids report:', error);
    return NextResponse.json(
      { success: false, error: `Failed to fetch voids report: ${error.message}` },
      { status: 500 }
    );
  }
}
