/**
 * Apply the selling price of already-RECEIVED purchase orders to their products.
 *
 * Before the fix in lib/purchase-actions.ts, receiving a PO only ever RAISED a
 * product's price ("highest wins"), and a Case line wrote price ÷ factor onto the
 * piece instead of updating the Case. So a received PO whose selling price was
 * lower than the old one — or that was bought by the Case — never reached the
 * product. This script finds, for each product selling unit, the MOST RECENT
 * received PO line that carried a selling price, and where that price differs
 * from the unit's current price, applies it exactly the way receiving now does
 * (via applyPurchaseSellingPrice).
 *
 *   npx tsx scripts/backfill-po-selling-prices.ts                     # preview only (default)
 *   npx tsx scripts/backfill-po-selling-prices.ts --since=2026-10-01  # only POs dated on/after
 *   npx tsx scripts/backfill-po-selling-prices.ts --apply             # write the changes
 *
 * Preview first. Only the latest PO per unit is considered, but if a price was
 * deliberately edited by hand AFTER that PO was received, applying would undo
 * that edit — check the list before running with --apply.
 *
 * "Received" means status = 'Received' OR an inventory_batches row exists for
 * the PO and product ('Paid' alone can precede receipt). Only the local DB is
 * written; cloud sync picks it up the usual way.
 */
import { query, withTransaction } from '../lib/mysql';
import { applyPurchaseSellingPrice } from '../lib/purchase-actions';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1];
if (sinceArg && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) {
  console.error('--since must be YYYY-MM-DD');
  process.exit(2);
}

const SQL = `
  WITH priced AS (
    SELECT
      poi.product_id,
      COALESCE(poi.selling_unit_id, base.id) AS unit_id,
      poi.selling_price,
      po.id AS po_id,
      COALESCE(po.reference_number, po.id) AS po_ref,
      DATE_FORMAT(po.date, '%Y-%m-%d') AS po_date,
      ROW_NUMBER() OVER (
        PARTITION BY poi.product_id, COALESCE(poi.selling_unit_id, base.id)
        ORDER BY po.updated_at DESC, po.date DESC, poi.id DESC
      ) AS rn
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    LEFT JOIN product_selling_units base
      ON base.product_id = poi.product_id AND base.is_base = 1
    WHERE poi.selling_price > 0
      AND (
        po.status = 'Received'
        OR EXISTS (
          SELECT 1 FROM inventory_batches ib
           WHERE ib.purchase_order_id = po.id AND ib.product_id = poi.product_id
        )
      )
      ${sinceArg ? 'AND po.date >= ?' : ''}
  )
  SELECT
    pr.product_id AS productId,
    p.name AS productName,
    su.id AS unitId,
    su.name AS unitName,
    su.is_base AS isBase,
    su.price AS currentPrice,
    pr.selling_price AS poPrice,
    pr.po_ref AS poRef,
    pr.po_date AS poDate
  FROM priced pr
  JOIN products p ON p.id = pr.product_id
  JOIN product_selling_units su ON su.id = pr.unit_id AND su.product_id = pr.product_id
  WHERE pr.rn = 1
    AND ROUND(su.price, 2) <> ROUND(pr.selling_price, 2)
  ORDER BY p.name, su.factor
`;

(async () => {
  try {
    const rows: any[] = await query(SQL, sinceArg ? [sinceArg] : []);

    if (rows.length === 0) {
      console.log('\nWalay product nga kinahanglan i-update — tanan nagtugma na sa ilang pinakabag-ong received PO.');
      process.exit(0);
    }

    console.table(
      rows.map((r) => ({
        Product: r.productName,
        Unit: r.unitName + (Number(r.isBase) ? ' (base)' : ''),
        'Current Price': Number(r.currentPrice).toFixed(2),
        'PO Price': Number(r.poPrice).toFixed(2),
        PO: r.poRef,
        'PO Date': r.poDate,
      })),
    );
    console.log(`\n${rows.length} ka selling unit ang dili tugma sa ilang pinakabag-ong received PO.`);

    if (!apply) {
      console.log('PREVIEW ra ni — walay giusab. Padagana pag-usab nga naay --apply para i-update.');
      process.exit(0);
    }

    await withTransaction(async (connection: any) => {
      const [lvl]: any = await connection.query('SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1');
      const defaultLevelId = lvl[0]?.id;
      for (const r of rows) {
        await applyPurchaseSellingPrice(connection, r.productId, r.unitId, Number(r.poPrice), defaultLevelId);
      }
    });
    console.log(`✅ Na-update ang ${rows.length} ka selling unit.`);
    process.exit(0);
  } catch (err) {
    console.error('Backfill failed — walay giusab (rolled back):', err);
    process.exit(1);
  }
})();
