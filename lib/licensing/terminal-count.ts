/**
 * Seat counting for cloud licenses.
 * ----------------------------------------------------------------------------
 * Every cloud terminal shares the 'HOSTED' fingerprint, so the license server
 * cannot count seats from activations the way it does for desktop. Instead the
 * POS reports how many terminals are configured and the server compares that
 * against the license's max_activations.
 */
// `query` is imported lazily (not at module top level) so this module carries
// no static dependency on lib/mysql.ts — that file has a side-effecting
// `import './init-scheduler'` that starts cron timers and keeps the Node
// event loop alive forever, which would hang a plain `tsx` unit-test run that
// only needs the pure `isSeatOverage` export below.
export async function countActiveTerminals(): Promise<number> {
  try {
    const { query } = await import('../mysql');
    const rows: any = await query(
      `SELECT COUNT(*) AS cnt FROM pos_terminals WHERE is_active = TRUE`
    );
    return Number(rows?.[0]?.cnt ?? 0);
  } catch {
    // Never let a counting failure break the heartbeat.
    return 0;
  }
}

/** Pure overage check. A null limit means unlimited. */
export function isSeatOverage(terminalCount: number, seatLimit: number | null): boolean {
  if (seatLimit === null) return false;
  return terminalCount > seatLimit;
}
