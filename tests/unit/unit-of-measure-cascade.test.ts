/**
 * Proves the unit-of-measure rename cascade against a real MySQL connection.
 *
 * `products.unit_of_measure` is free text with no FK, so renaming a unit must
 * re-label the products that referenced it by either its old name or its old
 * abbreviation. Everything here runs inside a transaction that is always rolled
 * back, so the live catalogue is never modified.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const UNIT_ID = '__test_uom_cascade__';
const PRODUCT_PREFIX = '__test_uom_prod__';

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await connection.beginTransaction();
  try {
    await connection.query(
      'INSERT INTO units_of_measure (id, name, abbreviation) VALUES (?, ?, ?)',
      [UNIT_ID, 'TestUnitOld', 'tuo'],
    );

    // Three products: one referencing the unit by name, one by abbreviation
    // (the shape most rows in this catalogue actually have), one unrelated.
    const rows = [
      [`${PRODUCT_PREFIX}by_name`, 'By Name', 'TestUnitOld'],
      [`${PRODUCT_PREFIX}by_abbrev`, 'By Abbrev', 'tuo'],
      [`${PRODUCT_PREFIX}unrelated`, 'Unrelated', 'Kilogram'],
      // The shape most of this catalogue actually has: a bare abbreviation for
      // a unit that is NOT being renamed. A name-only join misses this row.
      [`${PRODUCT_PREFIX}legacy_abbrev`, 'Legacy Abbrev', 'kg'],
    ];
    for (const [id, name, unit] of rows) {
      await connection.query(
        'INSERT INTO products (id, name, price, stock, unit_of_measure) VALUES (?, ?, 1, 0, ?)',
        [id, name, unit],
      );
    }

    // --- the cascade under test (mirrors updateUnitOfMeasure) ---
    const [prevRows]: any = await connection.query(
      'SELECT name, abbreviation FROM units_of_measure WHERE id = ?',
      [UNIT_ID],
    );
    const previous = prevRows[0];
    await connection.query(
      'UPDATE units_of_measure SET name = ?, abbreviation = ? WHERE id = ?',
      ['TestUnitNew', 'tun', UNIT_ID],
    );
    const oldLabels = [previous.name, previous.abbreviation].filter(Boolean);
    const [result]: any = await connection.query(
      `UPDATE products SET unit_of_measure = ?
       WHERE unit_of_measure IN (${oldLabels.map(() => '?').join(', ')})
         AND unit_of_measure <> ?`,
      ['TestUnitNew', ...oldLabels, 'TestUnitNew'],
    );

    assert.equal(result.affectedRows, 2, 'both referencing products are re-labelled');

    const [after]: any = await connection.query(
      'SELECT id, unit_of_measure FROM products WHERE id LIKE ? ORDER BY id',
      [`${PRODUCT_PREFIX}%`],
    );
    const byId = Object.fromEntries(after.map((r: any) => [r.id, r.unit_of_measure]));

    assert.equal(byId[`${PRODUCT_PREFIX}by_name`], 'TestUnitNew', 'name-referenced product follows the rename');
    assert.equal(byId[`${PRODUCT_PREFIX}by_abbrev`], 'TestUnitNew', 'abbreviation-referenced product follows the rename');
    assert.equal(byId[`${PRODUCT_PREFIX}unrelated`], 'Kilogram', 'unrelated product is untouched');
    assert.equal(byId[`${PRODUCT_PREFIX}legacy_abbrev`], 'kg', 'unrelated abbreviation row is untouched');

    // --- the display join: matches on name OR abbreviation ---
    const [joined]: any = await connection.query(
      `SELECT p.id,
              COALESCE(uom.abbreviation, p.unit_of_measure) AS unitOfMeasure,
              uom.id AS resolvedUnitId
       FROM products p
       LEFT JOIN units_of_measure uom
         ON p.unit_of_measure = uom.name OR p.unit_of_measure = uom.abbreviation
       WHERE p.id LIKE ? ORDER BY p.id`,
      [`${PRODUCT_PREFIX}%`],
    );
    const shown = Object.fromEntries(joined.map((r: any) => [r.id, r.unitOfMeasure]));
    const resolved = Object.fromEntries(joined.map((r: any) => [r.id, r.resolvedUnitId]));

    assert.equal(shown[`${PRODUCT_PREFIX}by_name`], 'tun', 'renamed product now displays the new abbreviation');
    assert.equal(shown[`${PRODUCT_PREFIX}by_abbrev`], 'tun', 'abbreviation-valued row resolves through the join');
    assert.equal(shown[`${PRODUCT_PREFIX}unrelated`], 'kg', 'a name-valued row resolves to its abbreviation');
    // The regression guard: a row storing only an abbreviation must resolve to
    // a real unit row, not merely echo its raw string back through COALESCE.
    // The old name-only join left resolvedUnitId NULL here, which is why the
    // products table never showed a looked-up abbreviation.
    assert.equal(shown[`${PRODUCT_PREFIX}legacy_abbrev`], 'kg', 'an abbreviation-valued row displays an abbreviation');
    assert.ok(
      resolved[`${PRODUCT_PREFIX}legacy_abbrev`],
      'an abbreviation-valued row actually resolves to a units_of_measure row',
    );

    console.log('unit-of-measure-cascade: all assertions passed');
  } finally {
    await connection.rollback();
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
