import { NextResponse } from 'next/server';
import { getPoolStats } from '@/lib/mysql';

// Live connection-pool saturation, for diagnosing "the app is hanging" or
// "simultaneous users can't work" reports.
//
// Deliberately NOT folded into /api/health: that route is the Electron
// launcher's identity probe and must not touch the database (importing
// lib/mysql also starts the cron scheduler), so it has to stay DB-free.
//
// Reading this costs no connection — the numbers come from the pool object
// itself, so it stays answerable precisely when the pool is exhausted and
// every query would block.
export async function GET() {
  const stats = getPoolStats();

  // saturated: every connection is out AND callers are queued behind them.
  // That is the state that makes the app appear to hang.
  const saturated =
    stats.free === 0 && (stats.waiting ?? 0) > 0 && stats.total === stats.limit;

  return NextResponse.json({
    success: true,
    saturated,
    ...stats,
    hint: saturated
      ? 'Pool exhausted with callers queued. Raise DB_POOL_LIMIT, or find what is holding connections too long.'
      : undefined,
    timestamp: new Date().toISOString(),
  });
}
