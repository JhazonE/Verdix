import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../../lib/mysql';

/**
 * Daily units sold for one product, for the product dialog's sparkline.
 *
 * Read from `sale_items`, not `stock_movements`: a movement row exists only
 * where the POS wrote one, while a sale item is the sale itself. Quantity is
 * scaled by `selling_unit_factor` so a Case sale counts as the base units it
 * actually removed (1 Case = 144 pieces), matching the figure `products.stock`
 * is kept in. Rows predating selling units have a NULL factor and mean the
 * base unit, so they count as 1.
 *
 * Voided and returned sales are excluded: `sales_transactions.status` is where
 * a void is recorded (the transaction_type column never gets 'void'), and its
 * values are the capitalised enum members 'Voided' and 'Returned' — not
 * lowercase, despite how they read elsewhere.
 *
 * Days with no sale are returned as zero rather than omitted, so the caller
 * can render a continuous axis without filling gaps itself.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '14', 10) || 14, 1), 90);

    const rows: any[] = await query(
      `SELECT DATE(si.created_at) AS day,
              SUM(si.quantity * COALESCE(si.selling_unit_factor, 1)) AS units
         FROM sale_items si
         JOIN sales_transactions st ON st.id = si.sale_id
        WHERE si.product_id = ?
          AND si.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
          AND (st.status IS NULL OR st.status NOT IN ('Voided', 'Returned'))
        GROUP BY DATE(si.created_at)
        ORDER BY day ASC`,
      [id, days - 1]
    );

    // mysql2 hands a DATE back as a Date at midnight LOCAL time, so
    // toISOString() here would roll it back a day in any timezone east of UTC
    // — a Manila sale on the 22nd bucketed onto the 21st. Read the local parts
    // instead, which is what MySQL's DATE() already meant.
    const localKey = (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

    const byDay = new Map<string, number>();
    for (const row of rows) {
      const key = row.day instanceof Date ? localKey(row.day) : String(row.day).slice(0, 10);
      byDay.set(key, Number(row.units) || 0);
    }

    // Build the full window locally so a quiet day is a zero, not a hole. Local
    // date parts, not toISOString(), which would shift the day by the UTC
    // offset and land a Manila sale on the wrong bar.
    const series: { date: string; units: number }[] = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    cursor.setDate(cursor.getDate() - (days - 1));

    for (let i = 0; i < days; i++) {
      const key = localKey(cursor);
      series.push({ date: key, units: byDay.get(key) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    const total = series.reduce((sum, point) => sum + point.units, 0);

    return NextResponse.json({
      success: true,
      data: {
        series,
        total,
        // Averaged over the whole window, including quiet days — this is a
        // run-rate, so dividing by only the days that had sales would overstate
        // it and make the cover estimate too optimistic.
        avgPerDay: days > 0 ? total / days : 0,
        // The caller shows the chart only when the product has actually sold;
        // a flat row of zeros is a fact about the data, not a trend.
        hasSales: total > 0,
      },
    });
  } catch (error) {
    console.error('Error fetching product sales history:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sales history' },
      { status: 500 }
    );
  }
}
