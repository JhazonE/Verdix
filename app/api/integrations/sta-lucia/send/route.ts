import { NextRequest, NextResponse } from 'next/server';
import { sendZReadingToStaLucia } from '@/lib/integrations/sta-lucia/send-z-reading';

/**
 * POST /api/integrations/sta-lucia/send
 * Body: { zReadingId?: string, apiId?: string }
 *
 * Omitting zReadingId submits the most recent Z-reading.
 */
export async function POST(request: NextRequest) {
  try {
    const { zReadingId, apiId } = await request.json().catch(() => ({}));
    const result = await sendZReadingToStaLucia(zReadingId, apiId);
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sta Lucia send failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
