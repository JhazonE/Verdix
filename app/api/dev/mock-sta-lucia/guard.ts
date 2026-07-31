import { NextResponse } from 'next/server';

/**
 * Mock endpoints exist for development and E2E only. In a production build they
 * must not exist at all — returning 404 rather than 403 keeps them invisible.
 *
 * The E2E suite runs with NODE_ENV=test on port 3100, so it is unaffected.
 */
export function blockedInProduction(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}
