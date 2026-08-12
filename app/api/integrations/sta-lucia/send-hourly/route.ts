import { NextRequest, NextResponse } from 'next/server';
import { sendHourlyStaLuciaSales } from '@/lib/integrations/sta-lucia/send-hourly-sales';

/**
 * POST /api/integrations/sta-lucia/send-hourly
 * Body: { hourStart?: string (ISO), apiId?: string }
 *
 * Omitting hourStart submits the most recently closed hour. Exists for
 * manual/on-demand submission and for the E2E suite — the automatic path is
 * the :05-past-the-hour cron in lib/scheduler.ts.
 */
export async function POST(request: NextRequest) {
  try {
    const { hourStart, apiId } = await request.json().catch(() => ({}));
    const parsedHour = hourStart ? new Date(hourStart) : undefined;
    const result = await sendHourlyStaLuciaSales(parsedHour, apiId);
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sta Lucia hourly send failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
