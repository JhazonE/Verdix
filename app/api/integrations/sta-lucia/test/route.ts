import { NextRequest, NextResponse } from 'next/server';
import { login, getTransactions, logout } from '@/lib/integrations/sta-lucia/client';
import { loadStaLuciaConfig } from '@/lib/integrations/sta-lucia/send-z-reading';
import type { StaLuciaSalesPayload } from '@/lib/integrations/sta-lucia/types';

/**
 * The shape a real submission would send, built but never transmitted — see
 * the route doc below. Returned to the caller so the operator can inspect the
 * exact bytes without anything reaching the mall.
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
  sale_type: false,
};

/**
 * POST /api/integrations/sta-lucia/test
 * Body: { apiId: string }
 *
 * READ-ONLY. NOTHING IS WRITTEN TO THE MALL.
 *
 * The flow is login → get-transactions → logout. It deliberately does NOT
 * POST to /api/get-sales. An earlier version did, which meant every click of
 * the Test button recorded a ₱0 sales entry dated today in MediaOne's system —
 * against a tenant whose rent is commonly computed as a percentage of reported
 * sales, and with no way to retract it. (The original design document
 * specified the send; the project owner overruled it for this reason.)
 *
 * Reading back transactions still proves everything a test needs to prove:
 * the credentials are accepted, both required headers (Authorization and
 * X-CUSTOM-TOKEN) are being sent and honoured, and the endpoint is reachable
 * within the configured timeout.
 *
 * The sample sales payload is still BUILT and returned in the response, so the
 * operator can inspect the exact bytes a real submission would send — seeing
 * the literal payload is the point; a boolean "connection OK" would not tell
 * you whether the mapping is right. It is simply never transmitted.
 *
 * Unlike the send path, a disabled config is accepted here: verifying
 * credentials before switching the integration on is legitimate precisely
 * because this route writes nothing.
 */
export async function POST(request: NextRequest) {
  try {
    const { apiId } = await request.json().catch(() => ({}));
    const cfg = await loadStaLuciaConfig(apiId, { includeDisabled: true });
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

    // Built for inspection only — deliberately NOT passed to sendSales().
    const payload: StaLuciaSalesPayload = {
      ...SAMPLE_PAYLOAD,
      date_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    const transactions = await getTransactions(cfg);
    steps.getTransactions = transactions;
    steps.logout = await logout(cfg);

    return NextResponse.json({
      success: transactions.success,
      /** Where a real submission WOULD post. Not called by this route. */
      salesEndpoint: `${cfg.apiEndpoint.replace(/\/+$/, '')}/api/get-sales`,
      /** Always false — this route never writes to the mall. */
      submitted: false,
      payload,
      response: transactions.response,
      steps,
      error: transactions.success ? undefined : transactions.error,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Sta Lucia test failed:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
