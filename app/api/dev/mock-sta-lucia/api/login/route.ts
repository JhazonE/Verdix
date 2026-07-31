import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/**
 * Local stand-in for POST {domain}/api/login on the Sta. Lucia Tenant
 * Management System. Mirrors the response shape documented in the source PDF
 * so the integration can be exercised with no credentials and no internet.
 */
export const MOCK_TOKEN = 'MOCK_TOKEN_ehywdhysgcydsjhcdsjhj1jdsd';
export const MOCK_OWNER_TOKEN = 'MOCK_OWNER_xclkvbnjaoshjfasd';

export async function POST(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  const { email, password } = body ?? {};

  if (!email || !password) {
    return NextResponse.json(
      { status: 0, message: 'Email and password are required' },
      { status: 422 },
    );
  }

  // A specific address lets tests exercise the inactive-account path.
  if (email === 'inactive@example.com') {
    return NextResponse.json({ status: 0, message: 'Account is inactive' }, { status: 200 });
  }

  return NextResponse.json({
    status: 1,
    role: 'tenant',
    token: MOCK_TOKEN,
    owner_token: MOCK_OWNER_TOKEN,
    user: { id: 101, name: 'Mock Tenant', email, status: 1 },
  });
}
