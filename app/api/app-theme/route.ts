import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../lib/mysql';
import { normalizeBrandColor } from '@/lib/color-themes';

/**
 * Store-wide brand colour (Developer Options → Color Theme).
 *
 * Stored on the single `pos_settings` row so every terminal sharing the
 * database renders the same colour. Holds `#rrggbb`, or 'default' for the
 * original palette. Deliberately its own endpoint rather than a field on
 * /api/pos-settings: every page of every terminal reads this on load, and that
 * route runs ~70 INFORMATION_SCHEMA checks per GET.
 */

const DEFAULT_MARKER = 'default';

// The column check runs once per server process, not once per request.
let columnReady = false;

async function ensureColumn() {
  if (columnReady) return;
  const cols: any = await query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_settings' AND COLUMN_NAME = 'color_theme'`
  );
  if (!cols?.length) {
    try {
      await query(
        `ALTER TABLE pos_settings ADD COLUMN color_theme VARCHAR(30) NOT NULL DEFAULT '${DEFAULT_MARKER}'`
      );
    } catch (e: any) {
      // Another terminal added it between our check and the ALTER.
      if (e?.code !== 'ER_DUP_FIELDNAME') throw e;
    }
  }
  columnReady = true;
}

export async function GET() {
  try {
    await ensureColumn();
    const rows: any = await query('SELECT color_theme FROM pos_settings LIMIT 1');
    // Anything that is not a hex colour (including the 'default' marker)
    // reads as null = original palette.
    return NextResponse.json({ success: true, color: normalizeBrandColor(rows?.[0]?.color_theme) });
  } catch (error) {
    console.error('Error fetching color theme:', error);
    // success:false tells the client to keep whatever it already shows.
    return NextResponse.json({ success: false, error: 'Failed to fetch color theme' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    // null resets to the default palette; anything else must be a colour.
    const color = body?.color === null ? null : normalizeBrandColor(body?.color);
    if (body?.color !== null && !color) {
      return NextResponse.json({ success: false, error: 'Invalid colour — use #rrggbb' }, { status: 400 });
    }

    await ensureColumn();
    const existing: any = await query('SELECT id FROM pos_settings LIMIT 1');
    if (!existing?.length) {
      return NextResponse.json(
        { success: false, error: 'POS settings have not been initialised yet' },
        { status: 409 }
      );
    }

    await query('UPDATE pos_settings SET color_theme = ? WHERE id = ?', [color ?? DEFAULT_MARKER, existing[0].id]);
    return NextResponse.json({ success: true, color });
  } catch (error) {
    console.error('Error updating color theme:', error);
    return NextResponse.json({ success: false, error: 'Failed to update color theme' }, { status: 500 });
  }
}
