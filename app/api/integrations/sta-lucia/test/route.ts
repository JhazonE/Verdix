import { NextRequest, NextResponse } from 'next/server';
import { login, sendSales, getTransactions, logout } from '@/lib/integrations/sta-lucia/client';
import { loadStaLuciaConfig } from '@/lib/integrations/sta-lucia/send-z-reading';
import type { StaLuciaSalesPayload } from '@/lib/integrations/sta-lucia/types';

/**
 * A representative payload used only for connection testing. It never touches
 * real sales data, so a test run cannot pollute the mall's records with
 * figures that look real — the values are deliberately small and round.
 */
const SAMPLE_PAYLOAD: StaLuciaSalesPayload = {
  credit: 0,
  debit: 0,
  gross_sales: 0,
  date_time: '',
  total_discounts: '0%',
  vat_exempt_sales: 0,
  vat_sales: 0,
  non_vat_sales: 0,
  vat_amount: 0,
  other_taxes: 0,
  net_sales: 0,
  number_of_transactions: 0,
};

/**
 * POST /api/integrations/sta-lucia/test
 * Body: { apiId: string }
 *
 * Runs the documented integration flow — login, submit, read back, logout —
 * and returns the exact payload that was sent alongside each raw response.
 * Seeing the literal bytes sent is the whole point; a boolean "connection OK"
 * would not tell you whether the mapping is right.
 */
export async function POST(request: NextRequest) {
  try {
    const { apiId } = await request.json().catch(() => ({}));
    const cfg = await loadStaLuciaConfig(apiId);
    if (!cfg) {
      return NextResponse.json(
        { success: false, error: 'No Sta Lucia API configured' },
        { status: 400 },
      );
    }

    const steps: Record<string, unknown> = {};

    try {
      const session = await login(cfg);
      steps.login = { success: true, ownerToken: session.ownerToken };
    } catch (e) {
      steps.login = { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
      return NextResponse.json({ success: false, steps, error: (steps.login as any).error });
    }

    const payload: StaLuciaSalesPayload = {
      ...SAMPLE_PAYLOAD,
      date_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    const sales = await sendSales(cfg, payload);
    steps.sendSales = sales;

    steps.getTransactions = await getTransactions(cfg);
    steps.logout = await logout(cfg);

    return NextResponse.json({
      success: sales.success,
      endpoint: `${cfg.apiEndpoint.replace(/\/+$/, '')}/api/get-sales`,
      payload,
      response: sales.response,
      steps,
      error: sales.success ? undefined : sales.error,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sta Lucia test failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
