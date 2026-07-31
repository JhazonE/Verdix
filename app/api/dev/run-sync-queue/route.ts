import { NextResponse } from 'next/server';
import { blockedInProduction } from '../mock-sta-lucia/guard';
import { processSyncQueue } from '@/lib/scheduler';

/**
 * POST /api/dev/run-sync-queue
 *
 * Runs one pass of the background retry sweep on demand, in-process, against
 * whatever database the server is pointed at.
 *
 * This exists for the E2E suite. The sweep is otherwise only reachable from a
 * two-minute cron inside the server process, and a spec cannot call
 * `processSyncQueue()` directly: the Playwright process resolves `lib/mysql`
 * against the dev `verdix` database while the server under test runs against
 * `verdix_test`, so importing it from a spec would sweep the wrong database.
 * Going over HTTP is what puts the sweep in the right process.
 *
 * Guarded by the same `blockedInProduction()` helper the Sta Lucia mocks use —
 * 404, not 403, so it does not exist at all in a production build.
 */
export async function POST() {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  await processSyncQueue();
  return NextResponse.json({ success: true });
}
