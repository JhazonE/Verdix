import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

/**
 * Expiring Soon report.
 *
 * Lists inventory batches with stock remaining whose expiration falls inside the
 * requested window, plus everything already expired. Batches with no expiry are
 * excluded — expiry is optional, and a NULL means "unknown", not "expires today".
 */
export async function GET(request: NextRequest) {
  try {
    const daysParam = request.nextUrl.searchParams.get('days');
    const parsedDays = daysParam ? parseInt(daysParam, 10) : 30;
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 365) : 30;

    const rows: any[] = await query(`
      SELECT
        b.id                  AS batchId,
        b.product_id          AS productId,
        p.name                AS productName,
        p.sku                 AS sku,
        b.quantity_remaining  AS quantityRemaining,
        DATE_FORMAT(b.expiration_date, '%Y-%m-%d') AS expirationDate,
        DATEDIFF(b.expiration_date, CURDATE())     AS daysUntilExpiry
      FROM inventory_batches b
      JOIN products p ON p.id = b.product_id
      WHERE b.expiration_date IS NOT NULL
        AND b.quantity_remaining > 0
        AND DATEDIFF(b.expiration_date, CURDATE()) <= ?
      ORDER BY b.expiration_date ASC
    `, [days]);

    const items = rows.map(r => ({
      ...r,
      quantityRemaining: Number(r.quantityRemaining),
      daysUntilExpiry: Number(r.daysUntilExpiry),
      isExpired: Number(r.daysUntilExpiry) < 0,
    }));

    return NextResponse.json({ success: true, days, items });
  } catch (error: any) {
    console.error('Expiring soon report error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load expiring stock' },
      { status: 500 }
    );
  }
}
