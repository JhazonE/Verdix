import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

const migration: Migration = {
  name: '126_backfill_base_unit_barcode_from_sku',
  timestamp: new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-'),

  async up(): Promise<void> {
    // Every product's base selling unit (is_base = 1) should have a barcode
    // once this plan's forms require one going forward. Pre-existing
    // products created before this change may not — backfill from their
    // own `sku` (already unique per (sku, warehouse_id)) rather than
    // generating a fresh random code, so existing printed labels /
    // external references that happen to already use the sku as a scan
    // code keep working.
    const baseUnitsMissingBarcode: any = await query(`
      SELECT psu.id AS selling_unit_id, psu.product_id, p.sku
      FROM product_selling_units psu
      JOIN products p ON p.id = psu.product_id
      WHERE psu.is_base = 1
        AND (psu.barcode IS NULL OR psu.barcode = '')
    `);

    let backfilled = 0;
    let skipped = 0;
    const skippedProductIds: string[] = [];

    for (const row of baseUnitsMissingBarcode) {
      const candidateBarcode = row.sku;
      if (!candidateBarcode) {
        skipped++;
        skippedProductIds.push(row.product_id);
        continue;
      }

      // A candidate barcode must not already be in use by ANY selling unit
      // (the unique index spans all selling units, not just base ones) —
      // check before writing rather than letting the INSERT/UPDATE's own
      // unique-constraint violation abort the whole migration partway
      // through.
      const [clash]: any = await query(
        'SELECT id FROM product_selling_units WHERE barcode = ? AND id != ? LIMIT 1',
        [candidateBarcode, row.selling_unit_id],
      );

      if (clash) {
        skipped++;
        skippedProductIds.push(row.product_id);
        console.warn(`⚠️  Skipped product ${row.product_id}: sku "${candidateBarcode}" already used as a barcode by selling unit ${clash.id}`);
        continue;
      }

      await query('UPDATE product_selling_units SET barcode = ? WHERE id = ?', [candidateBarcode, row.selling_unit_id]);
      backfilled++;
    }

    console.log(`✅ Backfilled ${backfilled} base selling unit barcode(s) from products.sku`);
    if (skipped > 0) {
      console.warn(`⚠️  ${skipped} product(s) skipped (sku collided with an existing barcode) — these still have no base unit barcode and must be resolved by hand before Add/Edit Product's barcode requirement can be relied on for them:`);
      console.warn(skippedProductIds.join(', '));
    }
  },

  async down(): Promise<void> {
    // Deliberately a no-op: reversing this would mean guessing which
    // barcodes were backfilled by this migration versus set by a user
    // afterward (e.g. by editing the product post-migration). Leaving
    // backfilled barcodes in place on rollback is the safe default — they
    // are valid, unique barcodes either way.
    console.log('ℹ️  No rollback: backfilled barcodes are left in place (see migration source for rationale).');
  }
};

registerMigration(migration);
