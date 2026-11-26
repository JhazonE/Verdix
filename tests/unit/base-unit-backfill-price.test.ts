/**
 * Migration 119 must seed each base selling unit with the price the till
 * actually charged before selling units existed — not the raw products.price.
 *
 * Before migration 118, both product read paths promoted the product's
 * DEFAULT price-level row over products.price, so products.price could sit
 * stale for months without anyone noticing (at one store it was the cost for
 * ~800 products, while the Retail row held the real price). 119 then copied
 * that stale figure into the base unit, 121 copied the Retail row beside it,
 * and the new resolver takes the LOWER of the two — so on the day of the
 * upgrade those products started ringing up at cost.
 *
 * Runs against a throwaway database created and dropped here, because the
 * shape under test (product_price_levels still present, no base units yet)
 * no longer exists in any migrated database.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { backfillBaseSellingUnits } from '../../scripts/migrations/base-selling-unit-backfill';

const DB = `__test_mig119_${Date.now()}`;

async function main() {
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  await admin.query(`CREATE DATABASE \`${DB}\``);
  try {
    await admin.query(`USE \`${DB}\``);
    // The pre-118 shape, trimmed to the columns the backfill reads.
    await admin.query(`
      CREATE TABLE price_levels (id VARCHAR(50) PRIMARY KEY, name VARCHAR(50), is_default TINYINT(1) DEFAULT 0);
      CREATE TABLE products (
        id VARCHAR(50) PRIMARY KEY, price DECIMAL(10,2) NOT NULL, cost DECIMAL(10,2),
        unit_of_measure VARCHAR(50), barcode VARCHAR(100)
      );
      CREATE TABLE product_price_levels (
        product_id VARCHAR(50) NOT NULL, price_level_id VARCHAR(50) NOT NULL,
        price DECIMAL(10,2) NOT NULL, min_quantity INT DEFAULT 0,
        PRIMARY KEY (product_id, price_level_id)
      );
      CREATE TABLE product_selling_units (
        id VARCHAR(100) PRIMARY KEY, product_id VARCHAR(50) NOT NULL, name VARCHAR(100) NOT NULL,
        barcode VARCHAR(100), factor DECIMAL(12,4) NOT NULL, cost DECIMAL(12,4),
        price DECIMAL(12,4) NOT NULL, is_base TINYINT(1) NOT NULL DEFAULT 0
      );
      INSERT INTO price_levels VALUES ('retail-level', 'Retail', 1), ('wholesale', 'Wholesale', 0);

      INSERT INTO products (id, price, cost, unit_of_measure) VALUES
        ('stale_shelf', 25, 25, 'Piece'),   -- the store's case: shelf = cost, Retail row 30
        ('row_lower',   499, 379, 'Piece'), -- Retail row 35 was what the till charged
        ('tiered_row',  40, 30, 'Piece'),   -- a tier on the default row still promoted pre-118
        ('other_level', 40, 30, 'Piece'),   -- only a Wholesale row: shelf price stands
        ('no_rows',     55, 40, NULL),      -- no rows at all: shelf price stands
        ('has_base',    10, 5, 'Piece');    -- already has a base unit: never touched
      INSERT INTO product_price_levels (product_id, price_level_id, price, min_quantity) VALUES
        ('stale_shelf', 'retail-level', 30, 0),
        ('row_lower',   'retail-level', 35, 0),
        ('tiered_row',  'retail-level', 45, 1),
        ('other_level', 'wholesale',    20, 0);
      INSERT INTO product_selling_units (id, product_id, name, factor, price, is_base)
        VALUES ('psu_existing', 'has_base', 'Piece', 1, 10, 1);
    `);

    const run = async (sql: string, params?: any[]) => (await admin.query(sql, params))[0];
    await backfillBaseSellingUnits(run);

    const [rows]: any = await admin.query(
      'SELECT product_id, name, price, is_base, factor FROM product_selling_units ORDER BY product_id');
    const priceOf = (id: string) => Number(rows.find((r: any) => r.product_id === id)?.price);

    assert.equal(priceOf('stale_shelf'), 30, 'base unit takes the Retail row the till charged, not the stale shelf price');
    assert.equal(priceOf('row_lower'), 35, 'a Retail row below the shelf price was still what the till charged');
    assert.equal(priceOf('tiered_row'), 45, 'pre-118 promotion ignored min_quantity (one default row per product)');
    assert.equal(priceOf('other_level'), 40, 'a non-default level never stood in for the shelf price');
    assert.equal(priceOf('no_rows'), 55, 'no price-level rows: products.price is the price');
    assert.equal(priceOf('has_base'), 10, 'an existing base unit is left exactly as it was');
    assert.equal(rows.length, 6, 'exactly one base unit per product');
    assert.ok(rows.every((r: any) => Number(r.is_base) === 1 && Number(r.factor) === 1), 'all rows are factor-1 base units');
    assert.equal(rows.find((r: any) => r.product_id === 'no_rows')?.name, 'Piece', 'blank unit_of_measure still falls back to Piece');

    // A database whose product_price_levels is already gone (fresh install
    // built from a post-121 snapshot) must still backfill from products.price.
    await admin.query(`
      DROP TABLE product_price_levels;
      INSERT INTO products (id, price, cost, unit_of_measure) VALUES ('fresh', 12, 8, 'Piece');
    `);
    await backfillBaseSellingUnits(run);
    const [[fresh]]: any = await admin.query("SELECT price FROM product_selling_units WHERE product_id = 'fresh'");
    assert.equal(Number(fresh.price), 12, 'without product_price_levels the shelf price is used');

    console.log('✓ base-unit-backfill-price: 119 seeds the base unit with the pre-118 till price');
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
    await admin.end();
  }
}

main().catch((err) => {
  console.error('✗ base-unit-backfill-price', err);
  process.exitCode = 1;
  throw err;
});
