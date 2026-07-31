import { NextRequest, NextResponse } from 'next/server';
import { blockedInProduction } from '../../guard';

/** Local stand-in for POST {domain}/api/logout. */
export async function POST(request: NextRequest) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json(
      { success: false, message: 'Missing Authorization header' },
      { status: 401 },
    );
  }
  return NextResponse.json({ success: true, message: 'Logged out' });
}
