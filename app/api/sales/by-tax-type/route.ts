import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { TAX_TYPES, TaxType, taxTypeExpr } from '@/lib/tax-utils';

/**
 * Sales by Tax Type — totals per BIR tax bucket (VAT / VAT Exempt /
 * Zero-Rated / Non-VAT) over a date range.
 *
 * WHY THIS IS A LINE-LEVEL REPORT. `tax_type` lives on
 * `pos_transaction_items`, not on the transaction, and a single receipt can
 * mix buckets: a senior citizen's basket has VAT_EXEMPT lines beside ordinary
 * VAT ones (see `resolveEffectiveTaxType` in lib/tax-utils.ts). Any report
 * that aggregates whole transactions therefore cannot answer "how much did we
 * sell per tax type" — it would have to assign a mixed receipt's full total to
 * one bucket. This endpoint sums LINES, so every peso lands in the bucket it
 * actually belongs to and the buckets add up to net sales.
 *
 * SOURCE IS POS ONLY, deliberately. `sales_invoice_items` and
 * `sales_order_items` have no tax column at all, so there is nothing to
 * classify them by. Including them would mean inventing a bucket for them;
 * instead they are excluded and the response says so via `scope`, which the UI
 * surfaces. Numbers here will therefore be lower than a report that counts all
 * sales sources.
 *
 * VAT ARITHMETIC. Prices in this system are VAT-INCLUSIVE, so a VATable line's
 * net is `line_total / 1.12` and its VAT is the remainder. This mirrors
 * `app/api/sales/bir-summary/route.ts` exactly — the two reports must agree,
 * since both are used for filing. The other three buckets carry no output VAT
 * by definition, so their net equals their gross.
 */

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
    const terminalId = sp.get('terminalId');
    const groupBy = sp.get('groupBy') === 'date' ? 'date' : 'none';

    const params: any[] = [];
    let where = '';

    if (startDate) {
      where += ' AND DATE(pt.transaction_time) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      where += ' AND DATE(pt.transaction_time) <= ?';
      params.push(endDate);
    }
    if (terminalId && terminalId !== 'all') {
      where += ' AND pt.terminal_id = ?';
      params.push(terminalId);
    }

    // Identical to the BIR Sales Summary's definition of a countable sale, so
    // the two reports reconcile. Training-mode transactions are never sales.
    const validSale = `st.status NOT IN ('Void', 'Voided', 'Cancelled', 'Returned') AND pt.is_training = 0`;

    const bucket = taxTypeExpr('pti');

    // ---- Totals per bucket -------------------------------------------------
    const summarySql = `
      SELECT
        ${bucket}                              AS tax_type,
        SUM(pti.quantity * pti.unit_price)     AS gross_sales,
        SUM(pti.discount_amount)               AS total_discount,
        SUM(pti.line_total)                    AS total_sales,
        SUM(pti.quantity)                      AS units_sold,
        COUNT(*)                               AS line_count,
        COUNT(DISTINCT pt.id)                  AS transaction_count
      FROM pos_transaction_items pti
      JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
      JOIN sales_transactions st ON pt.sale_id = st.id
      WHERE ${validSale} ${where}
      GROUP BY ${bucket}
    `;
    const summaryRows = (await query(summarySql, params)) as any[];

    const byType = new Map<string, any>(
      summaryRows.map((r) => [String(r.tax_type), r])
    );

    // Always emit all four buckets in a stable order, so the UI and the export
    // keep their columns even for a range where a bucket saw no sales.
    const buckets = TAX_TYPES.map((taxType: TaxType) => {
      const row = byType.get(taxType);
      const totalSales = num(row?.total_sales);
      // Only VATable lines carry output VAT. For the rest, net == gross.
      const netOfVat = taxType === 'VAT' ? totalSales / VAT_RATE : totalSales;
      const vatAmount = taxType === 'VAT' ? totalSales - netOfVat : 0;
      return {
        taxType,
        grossSales: num(row?.gross_sales),
        totalDiscount: num(row?.total_discount),
        totalSales,
        netOfVat,
        vatAmount,
        unitsSold: num(row?.units_sold),
        lineCount: Number(row?.line_count || 0),
        transactionCount: Number(row?.transaction_count || 0),
      };
    });

    const grandTotalSales = buckets.reduce((s, b) => s + b.totalSales, 0);
    const totals = {
      grossSales: buckets.reduce((s, b) => s + b.grossSales, 0),
      totalDiscount: buckets.reduce((s, b) => s + b.totalDiscount, 0),
      totalSales: grandTotalSales,
      netOfVat: buckets.reduce((s, b) => s + b.netOfVat, 0),
      vatAmount: buckets.reduce((s, b) => s + b.vatAmount, 0),
      unitsSold: buckets.reduce((s, b) => s + b.unitsSold, 0),
      lineCount: buckets.reduce((s, b) => s + b.lineCount, 0),
    };

    // Share of net sales, computed here so every consumer agrees. Guarded
    // because an empty range legitimately totals zero.
    const withShare = buckets.map((b) => ({
      ...b,
      shareOfSales: grandTotalSales > 0 ? (b.totalSales / grandTotalSales) * 100 : 0,
    }));

    // ---- Optional per-day breakdown ---------------------------------------
    // `transaction_count` is deliberately omitted per day: a transaction can
    // span buckets, so per-day-per-bucket counts would not sum to the day's
    // transaction count and would invite exactly that misreading.
    let daily: any[] = [];
    if (groupBy === 'date') {
      const dailySql = `
        SELECT
          DATE(pt.transaction_time)          AS report_date,
          ${bucket}                          AS tax_type,
          SUM(pti.line_total)                AS total_sales,
          SUM(pti.discount_amount)           AS total_discount,
          SUM(pti.quantity)                  AS units_sold
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
        JOIN sales_transactions st ON pt.sale_id = st.id
        WHERE ${validSale} ${where}
        GROUP BY DATE(pt.transaction_time), ${bucket}
        ORDER BY DATE(pt.transaction_time) ASC
      `;
      const dailyRows = (await query(dailySql, params)) as any[];

      const byDate = new Map<string, any>();
      for (const r of dailyRows) {
        const key = String(r.report_date);
        if (!byDate.has(key)) {
          byDate.set(key, {
            date: key,
            totalSales: 0,
            totalDiscount: 0,
            unitsSold: 0,
            byTaxType: Object.fromEntries(
              TAX_TYPES.map((t) => [t, { totalSales: 0, totalDiscount: 0, unitsSold: 0 }])
            ),
          });
        }
        const day = byDate.get(key);
        const sales = num(r.total_sales);
        const discount = num(r.total_discount);
        const units = num(r.units_sold);
        const key2 = String(r.tax_type);
        if (day.byTaxType[key2]) {
          day.byTaxType[key2] = { totalSales: sales, totalDiscount: discount, unitsSold: units };
        }
        day.totalSales += sales;
        day.totalDiscount += discount;
        day.unitsSold += units;
      }
      daily = Array.from(byDate.values());
    }

    return NextResponse.json({
      success: true,
      data: { buckets: withShare, totals, daily },
      // Stated in the payload rather than only in the UI, so an export or an
      // API consumer cannot present these figures as all-sources totals.
      scope: 'POS sales only — sales invoices and sales orders do not record a tax type.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching sales by tax type:', error);
    return NextResponse.json(
      {
        success: false,
        error: `Failed to fetch sales by tax type: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 }
    );
  }
}
