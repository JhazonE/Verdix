import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/**
 * Local stand-in for POST {domain}/api/get-sales.
 *
 * Rejecting when either required header is absent is the point of this mock:
 * it proves the client actually sends both Authorization and X-CUSTOM-TOKEN,
 * which no amount of reading the client code can prove.
 */
export async function POST(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const auth = request.headers.get('authorization');
  const custom = request.headers.get('x-custom-token');

  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, message: 'Missing or malformed Authorization header' },
      { status: 401 },
    );
  }
  if (!custom) {
    return NextResponse.json(
      { success: false, message: 'Missing X-CUSTOM-TOKEN header' },
      { status: 401 },
    );
  }

  const received = await request.json().catch(() => null);
  if (!received) {
    return NextResponse.json({ success: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  // Test hook: a request whose date_time carries this sentinel simulates the
  // mall's "already have this record" response, without needing two real
  // submissions in sequence to trigger it.
  if (received.date_time === 'SIMULATE_409') {
    return NextResponse.json(
      { success: false, message: 'Duplicate hourly sale' },
      { status: 409 },
    );
  }

  const required = [
    'credit', 'gross_sales', 'date_time', 'total_discounts', 'vat_exempt_sales',
    'vat_sales', 'non_vat_sales', 'vat_amount', 'other_taxes', 'net_sales',
    'sale_type',
  ];
  const missing = required.filter(k => received[k] === undefined || received[k] === null);
  if (missing.length) {
    return NextResponse.json(
      { success: false, message: `Missing required fields: ${missing.join(', ')}` },
      { status: 422 },
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Sales recorded',
    received,
  });
}
