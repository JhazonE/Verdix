/**
 * The INSERT behind migration 119, kept free of `lib/mysql` so it can be tested
 * against a throwaway database (importing lib/mysql starts the scheduler).
 *
 * `run` is any query function that returns rows for a SELECT and the result
 * header for a write — `query` from lib/mysql, or a mysql2 connection wrapper.
 *
 * WHICH PRICE the base unit gets is the whole point of this module.
 *
 * Before selling units, both product read paths promoted the product's
 * DEFAULT price-level row (product_price_levels) over products.price — so that
 * row, when present, was the price the till charged, and products.price could
 * sit stale without anyone noticing. At one store it equalled the COST for ~800
 * products while the Retail row held the real price.
 *
 * Copying the raw products.price here (as this migration first did) planted
 * that stale figure in the base unit. Migration 121 then copies the Retail row
 * onto the same unit, and the new resolver (lib/pricing.ts) takes the LOWER of
 * the two — so on upgrade day those products rang up at cost.
 *
 * So the unit is seeded with what the till actually charged: the default-level
 * row if the product has one, else products.price. That is the old promotion
 * rule exactly — one row per (product, level) by primary key, promoted whatever
 * its min_quantity — in BOTH directions: a Retail row below the shelf price was
 * also what customers paid. The unit and the row then agree, so the upgrade
 * changes no price at the till.
 *
 * products.price itself is deliberately left alone: nothing at the till reads
 * it raw (both read paths still promote the row), and rewriting a catalogue
 * column belongs in its own migration, not in a backfill.
 */
export type RunQuery = (sql: string, params?: any[]) => Promise<any>;

export async function backfillBaseSellingUnits(run: RunQuery): Promise<number> {
  // product_price_levels is dropped by 121, and a fresh install built from a
  // later schema snapshot never had it. Without it there is no promoted price,
  // and products.price is the price.
  const oldTable: any[] = await run(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_price_levels'`,
  );
  const defaultLevel: any[] = oldTable.length > 0
    ? await run('SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1')
    : [];
  const defaultLevelId: string | null = defaultLevel[0]?.id ?? null;

  const priceExpr = defaultLevelId
    ? `COALESCE(
        (SELECT ppl.price FROM product_price_levels ppl
          WHERE ppl.product_id = p.id AND ppl.price_level_id = ?),
        p.price, 0)`
    : 'COALESCE(p.price, 0)';

  const result: any = await run(`
    INSERT INTO product_selling_units
      (id, product_id, name, barcode, factor, cost, price, is_base)
    SELECT
      CONCAT('psu_base_', p.id),
      p.id,
      COALESCE(NULLIF(TRIM(p.unit_of_measure), ''), 'Piece'),
      NULLIF(TRIM(p.barcode), ''),
      1,
      p.cost,
      ${priceExpr},
      1
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1 FROM product_selling_units u
      WHERE u.product_id = p.id AND u.is_base = 1
    )
  `, defaultLevelId ? [defaultLevelId] : []);
  return result?.affectedRows ?? 0;
}
