import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import type { ImportPriceLevel } from '@/lib/import/entity-schemas';

/**
 * The price levels the product import can carry a column for.
 *
 * Served to the wizard so the column list is built from configuration rather
 * than hard-coded names. Failure is non-fatal: the wizard falls back to the
 * static schema and the import still works, just without level columns.
 */
export async function GET() {
  try {
    const rows = (await query(
      'SELECT id, name, is_default FROM price_levels ORDER BY name ASC',
    )) as any[];

    const levels: ImportPriceLevel[] = rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      isDefault: !!r.is_default,
    }));

    return NextResponse.json({ levels });
  } catch (error: any) {
    console.error('Error loading price levels for import:', error);
    return NextResponse.json({ levels: [] });
  }
}
