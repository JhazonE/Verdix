/**
 * Seat counting for cloud licenses.
 * ----------------------------------------------------------------------------
 * Every cloud terminal shares the 'HOSTED' fingerprint, so the license server
 * cannot count seats from activations the way it does for desktop. Instead the
 * POS reports how many terminals are configured and the server compares that
 * against the license's max_activations.
 */
import { query } from '../mysql';

export async function countActiveTerminals(): Promise<number> {
  try {
    const rows: any = await query(
      `SELECT COUNT(*) AS cnt FROM pos_terminals WHERE is_active = TRUE`
    );
    return Number(rows?.[0]?.cnt ?? 0);
  } catch {
    // Never let a counting failure break the heartbeat.
    return 0;
  }
}
