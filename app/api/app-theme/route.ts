import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../lib/mysql';
import { isColorThemeId, normalizeColorTheme, DEFAULT_COLOR_THEME } from '@/lib/color-themes';

/**
 * Store-wide colour theme (Developer Options → Color Theme).
 *
 * Stored on the single `pos_settings` row so every terminal sharing the
 * database renders the same theme. Deliberately its own endpoint rather than a
 * field on /api/pos-settings: every page of every terminal reads this on load,
 * and that route runs ~70 INFORMATION_SCHEMA checks per GET.
 */

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
        `ALTER TABLE pos_settings ADD COLUMN color_theme VARCHAR(30) NOT NULL DEFAULT '${DEFAULT_COLOR_THEME}'`
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
    return NextResponse.json({
      success: true,
      theme: normalizeColorTheme(rows?.[0]?.color_theme),
    });
  } catch (error) {
    console.error('Error fetching color theme:', error);
    // The client keeps whatever it already shows; the default is only a hint.
    return NextResponse.json(
      { success: false, theme: DEFAULT_COLOR_THEME, error: 'Failed to fetch color theme' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!isColorThemeId(body?.theme)) {
      return NextResponse.json({ success: false, error: 'Unknown color theme' }, { status: 400 });
    }

    await ensureColumn();
    const existing: any = await query('SELECT id FROM pos_settings LIMIT 1');
    if (!existing?.length) {
      return NextResponse.json(
        { success: false, error: 'POS settings have not been initialised yet' },
        { status: 409 }
      );
    }

    await query('UPDATE pos_settings SET color_theme = ? WHERE id = ?', [body.theme, existing[0].id]);
    return NextResponse.json({ success: true, theme: body.theme });
  } catch (error) {
    console.error('Error updating color theme:', error);
    return NextResponse.json({ success: false, error: 'Failed to update color theme' }, { status: 500 });
  }
}
