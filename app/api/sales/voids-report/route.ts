import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { formatSINumber } from '@/lib/si-number';
import { lineCostExpr } from '@/lib/cost-of-sale';
import { profitOf } from '@/lib/profit';
import { parseSalesSource } from '@/lib/sales-source';

// voided_by_name and void_reason are both added lazily by
// /api/pos/void-transaction — this report can be the first thing to run against a
// fresh DB, so it can't assume either column exists.
let voidColumnsChecked = false;
let hasVoidedByColumn = false;
let hasVoidReasonColumn = false;
let hasVoidSourceColumn = false;
async function checkVoidColumns() {
  if (voidColumnsChecked) return { hasVoidedByColumn, hasVoidReasonColumn, hasVoidSourceColumn };
  const cols = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sales_transactions' AND COLUMN_NAME IN ('voided_by_name', 'void_reason', 'void_source') AND TABLE_SCHEMA = DATABASE()"
  ) as any[];
  const names = new Set((cols as any[]).map((c: any) => c.COLUMN_NAME));
  hasVoidedByColumn = names.has('voided_by_name');
  hasVoidReasonColumn = names.has('void_reason');
  hasVoidSourceColumn = names.has('void_source');
  // Only cache once every column exists, so they take effect without a restart.
  voidColumnsChecked = hasVoidedByColumn && hasVoidReasonColumn && hasVoidSourceColumn;
  return { hasVoidedByColumn, hasVoidReasonColumn, hasVoidSourceColumn };
}

// sales_invoices' void audit columns come from migration 152. Until it has run,
// a back-office void is dated by updated_at and has no recorded user.
let invoiceVoidColumnsChecked = false;
let hasInvoiceVoidAudit = false;
async function checkInvoiceVoidColumns() {
  if (invoiceVoidColumnsChecked) return hasInvoiceVoidAudit;
  const cols = await query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sales_invoices' AND COLUMN_NAME IN ('voided_at', 'voided_by_name') AND TABLE_SCHEMA = DATABASE()"
  ) as any[];
  hasInvoiceVoidAudit = (cols as any[]).length === 2;
  // Only cache a positive answer, so running the migration takes effect
  // without restarting the server.
  invoiceVoidColumnsChecked = hasInvoiceVoidAudit;
  return hasInvoiceVoidAudit;
}

export async function GET(request: NextRequest) {
  try {
    const { hasVoidedByColumn: hasVoidedBy, hasVoidReasonColumn: hasVoidReason, hasVoidSourceColumn: hasVoidSource } =
      await checkVoidColumns();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate'); // yyyy-MM-dd
    const endDate = searchParams.get('endDate');     // yyyy-MM-dd
    // pos | backoffice | all — WHERE THE SALE CAME FROM, the same meaning the
    // other sales reports give it (lib/sales-source.ts). Where the void was
    // done is a separate thing, carried on each row as `source`.
    const saleSource = parseSalesSource(searchParams.get('source'));

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
        -- The Note column is the reason typed at the POS when voiding, which
        -- /api/pos/void-transaction writes to void_reason. st.notes holds the
        -- ORIGINAL sale's note (e.g. "POS Sale") and is not the void note.
        ${hasVoidReason ? 'st.void_reason' : 'NULL'} as note,
        -- NULL predates void_source; every such void came from the POS.
        ${hasVoidSource ? 'st.void_source' : 'NULL'} as void_source,
        (
          -- Cost per SELLING unit, preferring the batch cost captured at sale
          -- time. See lib/cost-of-sale.ts.
          SELECT COALESCE(SUM(${lineCostExpr('si', 'p', { hasCostAtSale: true })}), 0)
          FROM sale_items si
          LEFT JOIN products p ON si.product_id = p.id
          WHERE si.sale_id = st.id
        ) as total_cost
      FROM sales_transactions st
      LEFT JOIN pos_transactions pt ON pt.sale_id = st.id AND pt.transaction_type = 'sale'
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

    // Every sales_transactions row is a POS sale.
    const results = saleSource === 'backoffice' ? [] : await query(sql, params);

    // Back-office voids: an invoice voided from Sales → Invoices. That path marks
    // sales_invoices Voided and never touches sales_transactions, so the query
    // above cannot see it. A POS-sourced invoice whose linked sale was ALSO
    // voided at the POS is already listed above and is skipped here.
    const hasAudit = await checkInvoiceVoidColumns();
    const invVoidDate = hasAudit ? 'COALESCE(si.voided_at, si.updated_at)' : 'si.updated_at';
    let invSql = `
      SELECT
        si.id as invoice_id,
        si.reference,
        si.receipt_number,
        si.transaction_source,
        DATE(si.invoice_date) as trans_date,
        COALESCE(c.name, 'Walk-in Customer') as customer_name,
        sp.name as sales_person,
        ${invVoidDate} as void_date,
        ${hasAudit ? 'si.voided_by_name' : 'NULL'} as voided_by,
        si.total as sales_amount,
        COALESCE(si.vat_amount, 0) as vat_amount,
        (
          SELECT COALESCE(SUM(${lineCostExpr('sii', 'p', { hasCostAtSale: true })}), 0)
          FROM sales_invoice_items sii
          LEFT JOIN products p ON sii.product_id = p.id
          WHERE sii.sales_invoice_id = si.id
        ) as total_cost
      FROM sales_invoices si
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN sales_persons sp ON si.sales_person_id = sp.id
      WHERE si.status = 'Voided'
        AND NOT EXISTS (
          SELECT 1 FROM sales_transactions st2
          WHERE si.reference IS NOT NULL AND si.reference != ''
            AND st2.reference = si.reference AND st2.status = 'Voided'
        )
    `;
    const invParams: any[] = [];
    if (startDate) {
      invSql += ` AND ${invVoidDate} >= ?`;
      invParams.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      invSql += ` AND ${invVoidDate} < DATE_ADD(?, INTERVAL 1 DAY)`;
      invParams.push(endDate);
    }
    // A POS-sourced invoice here is a POS sale voided from the back office
    // before the two voids were linked; by origin it is still a POS sale.
    if (saleSource === 'pos') invSql += ` AND si.transaction_source = 'POS'`;
    if (saleSource === 'backoffice') invSql += ` AND COALESCE(si.transaction_source, '') <> 'POS'`;
    const invoiceResults = await query(invSql, invParams);

    const toAmounts = (row: any) => {
      const salesAmount = parseFloat(row.sales_amount) || 0;
      const totalCost = parseFloat(row.total_cost) || 0;
      const vatAmount = parseFloat(row.vat_amount) || 0;
      return {
        salesAmount,
        cost: totalCost,
        profit: profitOf(salesAmount, totalCost),
        // Vatable sales: sales amount minus VAT (VAT inclusive calculation)
        vatableSales: salesAmount - vatAmount,
        vatAmount,
      };
    };

    const posData = (results as any[]).map((row: any) => ({
      // Primary identifier is the real SI number of the voided sale.
      refNo: `SI No. ${row.si_number ? formatSINumber(row.si_number) : (row.order_number ?? 'N/A')}`,
      siNo: '',
      saleSource: 'pos' as 'pos' | 'backoffice',
      source: (row.void_source === 'Back Office' ? 'Back Office' : 'POS') as 'POS' | 'Back Office',
      transDate: row.trans_date,
      customer: row.customer_name,
      cashier: row.cashier_name || 'admin',
      voidDate: row.void_date,
      voidedBy: row.voided_by || 'admin',
      overrideBy: row.override_by || 'admin',
      ...toAmounts(row),
      note: row.note || ''
    }));

    const backOfficeData = (invoiceResults as any[]).map((row: any) => ({
      refNo: `INV ${row.reference || row.receipt_number || String(row.invoice_id).substring(0, 8)}`,
      siNo: '',
      saleSource: (row.transaction_source === 'POS' ? 'pos' : 'backoffice') as 'pos' | 'backoffice',
      source: 'Back Office' as 'POS' | 'Back Office',
      transDate: row.trans_date,
      customer: row.customer_name,
      cashier: row.sales_person || '-',
      voidDate: row.void_date,
      voidedBy: row.voided_by || '-',
      overrideBy: row.voided_by || '-',
      ...toAmounts(row),
      note: 'Voided from Back Office'
    }));

    const data = [...posData, ...backOfficeData].sort(
      (a, b) => new Date(b.voidDate).getTime() - new Date(a.voidDate).getTime()
    );

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
