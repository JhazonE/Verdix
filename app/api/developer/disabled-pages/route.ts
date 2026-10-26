import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../lib/mysql';
import { PAGE_REGISTRY, DEFAULT_HIDDEN_KEYS } from '@/lib/page-registry';

const TOGGLEABLE_KEYS = new Set(
  PAGE_REGISTRY.filter(p => !p.protected).map(p => p.key),
);

/**
 * A reserved `page_key` that is never a real page. Its presence records that
 * DEFAULT_HIDDEN_KEYS has already been applied to this database.
 *
 * The marker is what makes "default-hidden" expressible at all. `disabled_pages`
 * stores one row per HIDDEN page, so an empty table is ambiguous on its own: it
 * means both "nobody has configured anything yet" and "an admin deliberately
 * switched everything on". Seeding whenever the table is empty would re-hide
 * modules an admin had just enabled, on their very next page load.
 *
 * It is filtered out of every response and rejected on write, so no caller ever
 * sees it or can set it.
 */
const SEED_MARKER = '__defaults_seeded__';

/**
 * Creates `disabled_pages` if missing and applies DEFAULT_HIDDEN_KEYS exactly
 * once per database, so a new install starts with those modules hidden while an
 * admin's later choices are never overwritten.
 *
 * Keyed on the marker rather than on table creation: every pre-existing install
 * already has the table, so a creation-time seed would never fire there and the
 * migration would be the only thing applying the default. With the marker the
 * route is self-healing — it seeds any database that has not been seeded yet,
 * whether or not migration 146 ran.
 */
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS disabled_pages (
      page_key VARCHAR(100) NOT NULL PRIMARY KEY,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const marked: any = await query(
    'SELECT 1 FROM disabled_pages WHERE page_key = ? LIMIT 1',
    [SEED_MARKER]
  );
  if (marked?.length) return;

  // Claim the seed first. If two requests race here the PRIMARY KEY lets only
  // one win, and the loser's INSERT IGNOREs are harmless no-ops anyway.
  await query('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [SEED_MARKER]);

  // An install that already has rows has been configured by an admin (or by
  // migration 146), so its set is authoritative — mark it and leave it alone.
  const rows: any = await query(
    'SELECT COUNT(*) AS n FROM disabled_pages WHERE page_key <> ?',
    [SEED_MARKER]
  );
  if (Number(rows?.[0]?.n ?? 0) > 0) return;

  for (const key of DEFAULT_HIDDEN_KEYS) {
    if (!TOGGLEABLE_KEYS.has(key)) continue;
    await query('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [key]);
  }
}

export async function GET() {
  try {
    await ensureTable();
    // The marker is bookkeeping, not a page — never expose it.
    const rows = await query(
      'SELECT page_key FROM disabled_pages WHERE page_key <> ?',
      [SEED_MARKER],
    );
    return NextResponse.json({
      success: true,
      disabled: rows.map((r: any) => r.page_key),
    });
  } catch (error) {
    console.error('Error fetching disabled pages:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch disabled pages' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTable();
    const body = await request.json();
    const requested: string[] = Array.isArray(body.disabled) ? body.disabled : [];
    // Only persist keys that are known AND toggleable — drops protected/unknown,
    // and the marker with them (it is not in TOGGLEABLE_KEYS).
    const valid = [...new Set(requested)].filter(k => TOGGLEABLE_KEYS.has(k));

    // Keep the marker: wiping it would make the next GET re-seed the defaults
    // and undo the very save being made here.
    await query('DELETE FROM disabled_pages WHERE page_key <> ?', [SEED_MARKER]);
    await query('INSERT IGNORE INTO disabled_pages (page_key) VALUES (?)', [SEED_MARKER]);
    for (const key of valid) {
      await query('INSERT INTO disabled_pages (page_key) VALUES (?)', [key]);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating disabled pages:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update disabled pages' },
      { status: 500 },
    );
  }
}
