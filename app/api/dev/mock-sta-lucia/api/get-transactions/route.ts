import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/** Local stand-in for GET {domain}/api/get-transactions. */
export async function GET(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const auth = request.headers.get('authorization');
  const custom = request.headers.get('x-custom-token');

  if (!auth?.startsWith('Bearer ') || !custom) {
    return NextResponse.json(
      { success: false, message: 'Missing authentication headers' },
      { status: 401 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      total_transactions: 2,
      total_amount: 3400.0,
      individual_sales: [
        { id: 1, gross_sales: 1700.0, date_time: '2026-07-30 18:00:00' },
        { id: 2, gross_sales: 1700.0, date_time: '2026-07-31 18:00:00' },
      ],
    },
  });
}
