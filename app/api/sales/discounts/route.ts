import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

// Statutory discount (SC/PWD/NAAC/Solo Parent) report — lists each discounted line item
// together with the cardholder's name and ID number for BIR compliance.
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const startDate = sp.get('startDate');
    const endDate = sp.get('endDate');
    const type = sp.get('type'); // 'all' | senior | pwd | naac | solo_parent
    const search = sp.get('search') || '';

    const params: any[] = [];
    let where = `
      WHERE (pti.discount_id_number IS NOT NULL OR pti.discount_holder_name IS NOT NULL)
        AND pti.discount_type IN ('senior','pwd','naac','solo_parent')
        -- A voided sale's discount was never granted, and a training sale is a
        -- rehearsal with no BIR number. Both were listed here (and in the BIR
        -- statutory discount totals) because nothing filtered them out. Only
        -- these two are excluded: a sale later returned still had its
        -- discount granted on the day it was rung up.
        AND COALESCE(st.status, '') NOT IN ('Void', 'Voided')
        AND COALESCE(pt.is_training, 0) = 0
    `;

    if (startDate) {
      where += ` AND DATE(pt.transaction_time) >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND DATE(pt.transaction_time) <= ?`;
      params.push(endDate);
    }
    if (type && type !== 'all') {
      where += ` AND pti.discount_type = ?`;
      params.push(type);
    }
    if (search) {
      where += ` AND (pti.discount_holder_name LIKE ? OR pti.discount_id_number LIKE ? OR pti.product_name LIKE ? OR CAST(pt.order_number AS CHAR) LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const sql = `
      SELECT
        pt.transaction_time   AS transaction_date,
        pt.order_number       AS order_number,
        pt.sale_id            AS sale_id,
        st.reference          AS reference,
        st.receipt_number     AS receipt_number,
        st.si_number          AS si_number,
        st.bir_or_number      AS bir_or_number,
        pti.product_name,
        pti.discount_type,
        pti.discount_id_number,
        pti.discount_holder_name,
        pti.discount_percentage,
        pti.discount_amount,
        u.display_name        AS cashier_name
      FROM pos_transaction_items pti
      JOIN pos_transactions pt ON pti.pos_transaction_id = pt.id
      LEFT JOIN sales_transactions st ON pt.sale_id = st.id
      LEFT JOIN users u ON pt.user_id = u.uid
      ${where}
      ORDER BY pt.transaction_time DESC
    `;

    const rows = (await query(sql, params)) as any[];

    const data = rows.map((r) => ({
      transactionDate: r.transaction_date,
      orderNumber: r.order_number,
      saleId: r.sale_id,
      reference: r.reference,
      receiptNumber: r.receipt_number,
      // The BIR number the "OR/SI No." column should carry: SI for goods, OR
      // for services. order_number (shown before) is an internal counter.
      siOrNumber:
        r.si_number != null
          ? String(r.si_number).padStart(6, '0')
          : r.bir_or_number != null
            ? String(r.bir_or_number)
            : null,
      productName: r.product_name,
      discountType: r.discount_type,
      idNumber: r.discount_id_number,
      holderName: r.discount_holder_name,
      discountPercentage: parseFloat(r.discount_percentage || 0),
      discountAmount: parseFloat(r.discount_amount || 0),
      cashierName: r.cashier_name || 'Admin',
    }));

    return NextResponse.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching discount report:', error);
    return NextResponse.json(
      { success: false, error: `Failed to fetch discount report: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
