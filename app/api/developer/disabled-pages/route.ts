import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../../lib/mysql';
import { PAGE_REGISTRY } from '@/lib/page-registry';

const TOGGLEABLE_KEYS = new Set(
  PAGE_REGISTRY.filter(p => !p.protected).map(p => p.key),
);

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS disabled_pages (
      page_key VARCHAR(100) NOT NULL PRIMARY KEY,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function GET() {
  try {
    await ensureTable();
    const rows = await query('SELECT page_key FROM disabled_pages');
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
    // Only persist keys that are known AND toggleable — drops protected/unknown.
    const valid = [...new Set(requested)].filter(k => TOGGLEABLE_KEYS.has(k));

    await query('DELETE FROM disabled_pages');
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
