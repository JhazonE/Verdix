import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../lib/mysql';
import { profitOf } from '../../../../lib/profit';
import { backofficeInvoiceSql } from '../../../../lib/backoffice-sales';

/**
 * GET /api/sales/batch-analysis
 *
 * Returns batch-level profit analysis for sold items.
 * Each row represents units sold from a specific inventory batch.
 *
 * Query params:
 *   startDate  - YYYY-MM-DD (required)
 *   endDate    - YYYY-MM-DD (required)
 *   productId  - filter by specific product (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const productId = searchParams.get('productId');

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    // Fetch sale_items with batch_source JSON for the date range
    let params: any[] = [startDate, endDate];
    let productFilter = '';
    if (productId) {
      productFilter = 'AND si.product_id = ?';
      params.push(productId);
    }

    const sql = `
      SELECT
        si.id         AS saleItemId,
        si.product_id AS productId,
        p.name        AS productName,
        su.barcode    AS baseUnitBarcode,
        p.barcode,
        p.category,
        si.quantity   AS qtySold,
        si.price      AS sellingPrice,
        si.selling_unit_factor AS sellingUnitFactor,
        si.cost_at_sale AS costAtSale,
        si.batch_source AS batchSource,
        st.created_at   AS saleDate,
        st.reference    AS reference
      FROM sale_items si
      JOIN sales_transactions st ON si.sale_id = st.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
      WHERE DATE(st.created_at) BETWEEN ? AND ?
        AND si.batch_source IS NOT NULL
        ${productFilter}
      ORDER BY p.name ASC, st.created_at ASC
    `;

    const posRows: any[] = await query(sql, params);

    // BACK-OFFICE INVOICES. They deduct stock through the same FIFO batches and
    // CreateSaleUseCase writes batch_source onto sales_invoice_items exactly as
    // checkout does onto sale_items, but they never touch sale_items, so this
    // report could not see the batches they consumed. A Pending invoice counts
    // (see lib/backoffice-sales.ts); voided ones do not. Dated by invoice_date,
    // as in every other report, and returned as a 'YYYY-MM-DD' string so no
    // timezone conversion can move it a day.
    const boParams: any[] = [startDate, endDate];
    let boProductFilter = '';
    if (productId) {
      boProductFilter = 'AND sii.product_id = ?';
      boParams.push(productId);
    }
    const boRows: any[] = await query(
      `SELECT
         sii.id         AS saleItemId,
         sii.product_id AS productId,
         p.name         AS productName,
         su.barcode     AS baseUnitBarcode,
         p.barcode,
         p.category,
         sii.quantity   AS qtySold,
         sii.price      AS sellingPrice,
         sii.selling_unit_factor AS sellingUnitFactor,
         sii.cost_at_sale AS costAtSale,
         sii.batch_source AS batchSource,
         DATE_FORMAT(sinv.invoice_date, '%Y-%m-%d') AS saleDate,
         sinv.reference AS reference
       FROM sales_invoice_items sii
       JOIN sales_invoices sinv ON sii.sales_invoice_id = sinv.id
       JOIN products p ON sii.product_id = p.id
       LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
       WHERE ${backofficeInvoiceSql('sinv')}
         AND DATE(sinv.invoice_date) BETWEEN ? AND ?
         AND sii.batch_source IS NOT NULL
         ${boProductFilter}`,
      boParams
    );

    // Same order the single query had: product name, then sale date.
    const dayOf = (v: any) => (v ? new Date(v).getTime() : 0);
    const rows: any[] = [...posRows, ...boRows].sort(
      (a, b) =>
        String(a.productName).localeCompare(String(b.productName)) ||
        dayOf(a.saleDate) - dayOf(b.saleDate)
    );

    // Expand batch_source JSON into individual rows for the analysis table
    const analysis: any[] = [];

    for (const row of rows) {
      let splits: any[] = [];
      try {
        splits = typeof row.batchSource === 'string'
          ? JSON.parse(row.batchSource)
          : row.batchSource || [];
      } catch { splits = []; }

      // si.price is per SELLING unit sold, but a batch split's qty is always
      // in BASE units (batches are stocked and consumed in base units). Scale
      // the price down to a per-base-unit figure before pairing it with a
      // split's base-unit qty, or revenue overstates by the factor on every
      // non-base sale. NULL factor means base unit (1).
      const sellingUnitFactor = parseFloat(row.sellingUnitFactor) || 1;
      const sellingPrice = (parseFloat(row.sellingPrice) || 0) / sellingUnitFactor;

      for (const split of splits) {
        const qty = parseFloat(split.qty) || 0;
        const unitCost = parseFloat(split.unitCost) || 0;
        const lineRevenue = qty * sellingPrice;
        const lineCost = qty * unitCost;
        const lineProfit = profitOf(lineRevenue, lineCost);
        const margin = lineRevenue > 0 ? (lineProfit / lineRevenue) * 100 : 0;

        // Try to get batch details (received_date, PO reference)
        let batchDate: string | null = null;
        let poReference: string | null = null;

        if (split.batchId && split.batchId !== 'fallback') {
          try {
            const batchRows: any[] = await query(
              'SELECT received_date, purchase_order_id FROM inventory_batches WHERE id = ?',
              [split.batchId]
            );
            if (batchRows.length > 0) {
              batchDate = batchRows[0].received_date
                ? new Date(batchRows[0].received_date).toISOString().split('T')[0]
                : null;
              poReference = batchRows[0].purchase_order_id;
            }
          } catch { /* batch table might not exist pre-migration */ }
        }

        analysis.push({
          saleDate: row.saleDate
            ? typeof row.saleDate === 'string'
              ? row.saleDate
              : new Date(row.saleDate).toISOString().split('T')[0]
            : null,
          saleReference: row.reference,
          productId: row.productId,
          productName: row.productName,
          baseUnitBarcode: row.baseUnitBarcode,
          barcode: row.barcode,
          category: row.category,
          batchId: split.batchId,
          batchReceivedDate: batchDate,
          poReference,
          batchType: split.type || 'batch',
          qtySold: qty,
          unitCost,
          unitSellingPrice: sellingPrice,
          lineRevenue,
          lineCost,
          lineProfit,
          marginPct: parseFloat(margin.toFixed(2)),
        });
      }
    }

    // Summary totals
    const totals = analysis.reduce(
      (acc, row) => ({
        qty: acc.qty + row.qtySold,
        revenue: acc.revenue + row.lineRevenue,
        cost: acc.cost + row.lineCost,
        profit: acc.profit + row.lineProfit,
      }),
      { qty: 0, revenue: 0, cost: 0, profit: 0 }
    );

    return NextResponse.json({
      success: true,
      data: analysis,
      totals: {
        ...totals,
        marginPct: totals.revenue > 0
          ? parseFloat(((totals.profit / totals.revenue) * 100).toFixed(2))
          : 0,
      },
      count: analysis.length,
    });
  } catch (error: any) {
    console.error('[BatchAnalysis] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch batch analysis' },
      { status: 500 }
    );
  }
}
