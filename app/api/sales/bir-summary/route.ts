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
    //
    // Same arithmetic as the Z-reading (lib/reading-totals.ts), so the two
    // reconcile:
    //     gross = sales + discounts + voids      (everything rung up)
    //     net   = gross − discounts − returns − voids = sales − returns
    //
    // The sales columns (gross, vatable, VAT, exempt, zero-rated) therefore
    // read SALE lines only. A return is a separate pos_transactions row
    // (transaction_type = 'return') under the original sale, and it used to be
    // summed in here as negative lines: it shrank gross and VAT instead of
    // appearing as a deduction, while the Returns column (looked up by
    // st.status = 'Returned', which nothing sets) always read 0. Gross minus
    // Total Deductions then did not equal Net. Returns are now the deduction
    // and the VAT on them a VAT adjustment, so Net and VAT Payable are what
    // they were; only where the return is shown has changed.
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
      WHERE ${validSale} AND pt.transaction_type = 'sale' ${dateWhere}
      GROUP BY DATE(pt.transaction_time)
      ORDER BY DATE(pt.transaction_time) ASC
    `;
    const dailyRows = (await query(dailySql, dateParams)) as any[];

    // Returns per day: the money refunded, from the return rows themselves and
    // dated by when the return happened, as the Z-reading takes them. The VAT
    // on them comes from their lines, by tax type, so a returned VAT-exempt
    // item carries no VAT adjustment.
    const returnsSql = `
      SELECT DATE(pt.transaction_time) AS report_date,
             ABS(SUM(pti.line_total)) AS amount,
             ABS(SUM(CASE WHEN COALESCE(pti.tax_type,'VAT') = 'VAT'
                          THEN pti.line_total - (pti.line_total / ${VAT_RATE}) ELSE 0 END)) AS vat
      FROM pos_transaction_items pti
      JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
      JOIN sales_transactions st ON pt.sale_id = st.id
      WHERE pt.transaction_type = 'return' AND pt.is_training = 0
        AND st.status NOT IN ('Void', 'Voided', 'Cancelled') ${dateWhere}
      GROUP BY DATE(pt.transaction_time)
    `;
    const returnRows = (await query(returnsSql, dateParams)) as any[];
    const returnsByDate = new Map<string, number>(
      returnRows.map((r) => [String(r.report_date), num(r.amount)])
    );
    const returnVatByDate = new Map<string, number>(
      returnRows.map((r) => [String(r.report_date), num(r.vat)])
    );

    // Voids per day (status void/cancelled)
    const voidsSql = `
      SELECT DATE(pt.transaction_time) AS report_date, SUM(st.total) AS amount
      FROM sales_transactions st
      JOIN pos_transactions pt ON st.id = pt.sale_id
      -- Only the sale's own row: a sale that also had a return has a second
      -- pos_transactions row, and joining both counted its total twice.
      WHERE st.status IN ('Void', 'Voided', 'Cancelled') AND pt.is_training = 0
        AND pt.transaction_type = 'sale' ${dateWhere}
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

    // A day with only a return or only a void has no sale lines, but its
    // deduction still has to be reported, so it gets a row of its own.
    const salesDays = new Set(dailyRows.map((r) => String(r.report_date)));
    for (const r of [...returnRows, ...voidRows]) {
      const key = String(r.report_date);
      if (!salesDays.has(key)) {
        salesDays.add(key);
        dailyRows.push({ report_date: r.report_date });
      }
    }
    dailyRows.sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime());

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
      const vatOnReturns = returnVatByDate.get(date) || 0;
      const totalVatAdjustment = vatAdjSenior + vatAdjPwd + vatAdjOther + vatOnReturns;

      const vatAmount = num(r.vat_amount);
      const vatPayable = vatAmount - totalVatAdjustment;
      // Sale lines after discounts, less the day's refunds (= gross − total
      // deductions). Unchanged from when returns were summed in as lines.
      const netSales = num(r.net_sales) - returns;
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
        // Everything rung up: sale lines before discount, plus voided sales.
        grossSales: num(r.gross_sales) + voids,
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
          -- The BIR number of the sale: si_number for goods, bir_or_number
          -- for services. receipt_number is a per-terminal receipt counter
          -- unrelated to the SI series (see the daily summary above).
          MAX(st.si_number)                                                        AS si_number,
          MAX(st.bir_or_number)                                                    AS bir_or_number,
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
          AND pt.transaction_type = 'sale'
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
          r.si_number != null
            ? String(r.si_number).padStart(6, '0')
            : r.bir_or_number != null
              ? String(r.bir_or_number)
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
