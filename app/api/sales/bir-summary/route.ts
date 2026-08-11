import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

// BIR Sales Summary Report (per RR 16-2018 / RMO style):
//   - dailySummary  : one row per business day with gross/VAT breakdown, deductions and VAT adjustments
//   - seniorBook    : Senior Citizen Sales Book
//   - pwdBook       : Person With Disability Sales Book
//   - naacBook      : National Athletes & Coaches Sales Book
//   - soloParentBook: Solo Parent Sales Book
//
// Captured per pos_transaction_items: discount_type, discount_id_number, discount_holder_name,
// discount_percentage, discount_amount, tax_type, line_total, quantity, unit_price.
// TIN, child details (solo parent) and PNSTM ID are not captured at checkout, so those BIR
// columns are returned as null and rendered as "—".

const VAT_RATE = 1.12;
const num = (v: any): number => {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const startDate = sp.get('startDate');
    const endDate = sp.get('endDate');

    const dateParams: any[] = [];
    let dateWhere = '';
    if (startDate) {
      dateWhere += ' AND DATE(pt.transaction_time) >= ?';
      dateParams.push(startDate);
    }
    if (endDate) {
      dateWhere += ' AND DATE(pt.transaction_time) <= ?';
      dateParams.push(endDate);
    }

    // Only valid (non-void / non-return) sales feed the day's gross figures.
    const validSale = `st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') AND pt.is_training = 0`;

    // ---- Daily summary: aggregate line items per business day --------------
    const dailySql = `
      SELECT
        DATE(pt.transaction_time)                                          AS report_date,
        -- SI numbers (goods sales), not receipt_number: receipt_number is a
        -- generic per-terminal receipt counter unrelated to the BIR SI
        -- series (see getNextReceiptNumber() vs getNextSINumber() in
        -- lib/mysql.ts). MIN/MAX already ignore NULLs, so days with no SI
        -- sales simply report NULL here, handled below.
        MIN(st.si_number)                                                  AS beginning_si,
        MAX(st.si_number)                                                  AS ending_si,
        -- BIR OR numbers (services sales), kept in their own MIN/MAX pair
        -- rather than merged with si_number above: si_number and
        -- bir_or_number are independent BIR numbering sequences (goods vs.
        -- services), so mixing them into one range would misrepresent
        -- either series when filing.
        MIN(st.bir_or_number)                                              AS beginning_or,
        MAX(st.bir_or_number)                                              AS ending_or,
        SUM(pti.quantity * pti.unit_price)                                 AS gross_sales,
        SUM(pti.line_total)                                                AS net_sales,
        SUM(CASE WHEN COALESCE(pti.tax_type,'VAT') = 'VAT' THEN pti.line_total ELSE 0 END)               AS vat_incl_total,
        SUM(CASE WHEN COALESCE(pti.tax_type,'VAT') = 'VAT' THEN pti.line_total / ${VAT_RATE} ELSE 0 END) AS vatable_sales,
        SUM(CASE WHEN COALESCE(pti.tax_type,'VAT') = 'VAT' THEN pti.line_total - (pti.line_total / ${VAT_RATE}) ELSE 0 END) AS vat_amount,
        SUM(CASE WHEN pti.tax_type = 'VAT_EXEMPT' THEN pti.line_total ELSE 0 END)                        AS vat_exempt,
        SUM(CASE WHEN pti.tax_type = 'ZERO_RATED' THEN pti.line_total ELSE 0 END)                        AS zero_rated,
        SUM(CASE WHEN pti.discount_type = 'senior' THEN pti.discount_amount ELSE 0 END)                  AS disc_senior,
        SUM(CASE WHEN pti.discount_type = 'pwd' THEN pti.discount_amount ELSE 0 END)                     AS disc_pwd,
        SUM(CASE WHEN pti.discount_type = 'naac' THEN pti.discount_amount ELSE 0 END)                    AS disc_naac,
        SUM(CASE WHEN pti.discount_type = 'solo_parent' THEN pti.discount_amount ELSE 0 END)             AS disc_solo,
        SUM(CASE WHEN pti.discount_type NOT IN ('senior','pwd','naac','solo_parent') THEN pti.discount_amount ELSE 0 END) AS disc_other
      FROM pos_transaction_items pti
      JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
      JOIN sales_transactions st ON pt.sale_id = st.id
      WHERE ${validSale} ${dateWhere}
      GROUP BY DATE(pt.transaction_time)
      ORDER BY DATE(pt.transaction_time) ASC
    `;
    const dailyRows = (await query(dailySql, dateParams)) as any[];

    // Returns per day (status = 'Returned')
    const returnsSql = `
      SELECT DATE(pt.transaction_time) AS report_date, SUM(st.total) AS amount
      FROM sales_transactions st
      JOIN pos_transactions pt ON st.id = pt.sale_id
      WHERE st.status = 'Returned' AND pt.is_training = 0 ${dateWhere}
      GROUP BY DATE(pt.transaction_time)
    `;
    const returnRows = (await query(returnsSql, dateParams)) as any[];
    const returnsByDate = new Map<string, number>(
      returnRows.map((r) => [String(r.report_date), num(r.amount)])
    );

    // Voids per day (status void/cancelled)
    const voidsSql = `
      SELECT DATE(pt.transaction_time) AS report_date, SUM(st.total) AS amount
      FROM sales_transactions st
      JOIN pos_transactions pt ON st.id = pt.sale_id
      WHERE st.status IN ('Void', 'Voided', 'Cancelled') AND pt.is_training = 0 ${dateWhere}
      GROUP BY DATE(pt.transaction_time)
    `;
    const voidRows = (await query(voidsSql, dateParams)) as any[];
    const voidsByDate = new Map<string, number>(
      voidRows.map((r) => [String(r.report_date), num(r.amount)])
    );

    // Grand accumulated beginning balance = running total of net sales prior to each day.
    let runningBalance = 0;
    if (startDate) {
      const priorSql = `
        SELECT SUM(pti.line_total) AS prior_total
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
        JOIN sales_transactions st ON pt.sale_id = st.id
        WHERE ${validSale} AND DATE(pt.transaction_time) < ?
      `;
      const [priorRow] = (await query(priorSql, [startDate])) as any[];
      runningBalance = num(priorRow?.prior_total);
    }

    const pct = (numerator: number) => numerator - numerator / VAT_RATE; // VAT portion of a VAT-inclusive amount

    const dailySummary = dailyRows.map((r) => {
      const date = String(r.report_date);
      const discSenior = num(r.disc_senior);
      const discPwd = num(r.disc_pwd);
      const discNaac = num(r.disc_naac);
      const discSolo = num(r.disc_solo);
      const discOther = num(r.disc_other);
      const returns = returnsByDate.get(date) || 0;
      const voids = voidsByDate.get(date) || 0;
      const totalDeductions = discSenior + discPwd + discNaac + discSolo + discOther + returns + voids;

      // VAT adjustment = VAT portion of statutory discounts + VAT on returns (these reduce output VAT)
      const vatAdjSenior = pct(discSenior);
      const vatAdjPwd = pct(discPwd);
      const vatAdjOther = pct(discNaac + discSolo + discOther);
      const vatOnReturns = pct(returns);
      const totalVatAdjustment = vatAdjSenior + vatAdjPwd + vatAdjOther + vatOnReturns;

      const vatAmount = num(r.vat_amount);
      const vatPayable = vatAmount - totalVatAdjustment;
      const netSales = num(r.net_sales);
      const grandBeginning = runningBalance;
      runningBalance += netSales;

      return {
        date,
        // si_number is already stored zero-padded to 6 digits (getNextSINumber());
        // padStart here is a harmless no-op safeguard, matching this report's
        // pre-existing convention for the (also pre-padded) receipt_number field.
        beginningSI: r.beginning_si != null ? String(r.beginning_si).padStart(6, '0') : '—',
        endingSI: r.ending_si != null ? String(r.ending_si).padStart(6, '0') : '—',
        // bir_or_number already carries its own "OR-" prefix (getNextBirOrNumber()),
        // so it is used as-is — no padding/prefixing, unlike the SI fields above.
        beginningOR: r.beginning_or != null ? String(r.beginning_or) : '—',
        endingOR: r.ending_or != null ? String(r.ending_or) : '—',
        grandAccumulatedBeginning: grandBeginning,
        manualSiOr: 0, // sales issued with manual SI/OR (per RR 16-2018) — not captured by the POS
        grossSales: num(r.gross_sales),
        vatableSales: num(r.vatable_sales),
        vatAmount,
        vatExempt: num(r.vat_exempt),
        zeroRated: num(r.zero_rated),
        // Deductions
        discSenior,
        discPwd,
        discNaac,
        discSolo,
        discOther,
        returns,
        voids,
        totalDeductions,
        // VAT adjustments
        vatAdjSenior,
        vatAdjPwd,
        vatAdjOther,
        vatOnReturns,
        vatAdjOthers: 0,
        totalVatAdjustment,
        // Totals
        vatPayable,
        netSales,
        salesOverrun: 0,
        totalIncome: netSales,
        resetCounter: 0,
        zCounter: 0,
        remarks: '',
      };
    });

    // ---- Statutory sales books (one row per SI/OR per cardholder) ----------
    const buildBook = async (type: string) => {
      const sql = `
        SELECT
          MIN(pt.transaction_time)                                                 AS transaction_date,
          MAX(st.receipt_number)                                                   AS receipt_number,
          pt.order_number                                                          AS order_number,
          pti.discount_holder_name                                                 AS holder_name,
          pti.discount_id_number                                                   AS id_number,
          SUM(pti.quantity * pti.unit_price)                                       AS sales_inclusive_vat,
          SUM(CASE WHEN COALESCE(pti.tax_type,'VAT') = 'VAT' THEN (pti.quantity * pti.unit_price) - ((pti.quantity * pti.unit_price) / ${VAT_RATE}) ELSE 0 END) AS vat_amount,
          SUM(CASE WHEN pti.tax_type = 'VAT_EXEMPT' THEN (pti.quantity * pti.unit_price) ELSE (pti.quantity * pti.unit_price) / ${VAT_RATE} END) AS vat_exempt_sales,
          MAX(pti.discount_percentage)                                             AS discount_percentage,
          SUM(pti.discount_amount)                                                 AS discount_amount,
          SUM(pti.line_total)                                                      AS net_sales
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
        JOIN sales_transactions st ON pt.sale_id = st.id
        WHERE pti.discount_type = ?
          AND st.status NOT IN ('Void', 'Voided', 'Cancelled')
          AND pt.is_training = 0
          ${dateWhere}
        GROUP BY pt.id, pti.discount_id_number, pti.discount_holder_name, pt.order_number
        ORDER BY MIN(pt.transaction_time) ASC
      `;
      const rows = (await query(sql, [type, ...dateParams])) as any[];
      return rows.map((r) => ({
        date: r.transaction_date,
        holderName: r.holder_name || '—',
        idNumber: r.id_number || '—',
        tin: null, // not captured at checkout
        siOrNumber:
          r.receipt_number != null
            ? String(r.receipt_number).padStart(6, '0')
            : String(r.order_number || '').padStart(6, '0'),
        salesInclusiveVat: num(r.sales_inclusive_vat),
        vatAmount: num(r.vat_amount),
        vatExemptSales: num(r.vat_exempt_sales),
        discountPercentage: num(r.discount_percentage),
        discountAmount: num(r.discount_amount),
        netSales: num(r.net_sales),
      }));
    };

    const [seniorBook, pwdBook, naacBook, soloParentBook] = await Promise.all([
      buildBook('senior'),
      buildBook('pwd'),
      buildBook('naac'),
      buildBook('solo_parent'),
    ]);

    return NextResponse.json({
      success: true,
      data: { dailySummary, seniorBook, pwdBook, naacBook, soloParentBook },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching BIR sales summary:', error);
    return NextResponse.json(
      {
        success: false,
        error: `Failed to fetch BIR sales summary: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}
