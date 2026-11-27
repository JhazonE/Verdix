import { NextRequest, NextResponse } from 'next/server';
import { parseSalesSource } from '@/lib/sales-source';
import { salesCostByPeriod } from '@/lib/sales-cost-by-period';
import { buildGrossProfitReport, monthRange, parseMonth } from '@/lib/gross-profit-report';

/**
 * GET /api/reports/gross-profit?month=YYYY-MM&source=all|pos|backoffice
 *
 * Sales, Cost of Goods Sold & Gross Profit Monitoring: one row per day of the
 * month. Figures come from the same helper as the Fiscal Year report's monthly
 * breakdown (lib/sales-cost-by-period.ts), so this month's total here equals
 * that month's row there.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = parseSalesSource(searchParams.get('source'));

    const rawMonth = searchParams.get('month');
    const now = new Date();
    const parsed = rawMonth ? parseMonth(rawMonth) : { year: now.getFullYear(), month: now.getMonth() + 1 };
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'month must be YYYY-MM' },
        { status: 400 }
      );
    }

    const { startStr, endStr } = monthRange(parsed.year, parsed.month);
    const byDay = await salesCostByPeriod({ startStr, endStr, source, period: 'day' });
    const report = buildGrossProfitReport(parsed.year, parsed.month, byDay);

    return NextResponse.json({ success: true, source, ...report });
  } catch (error: any) {
    console.error('Error fetching gross profit report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch gross profit report', details: error?.message },
      { status: 500 }
    );
  }
}
