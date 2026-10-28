/**
 * Pre-flight check for an in-place upgrade of an older install (e.g. 1.19.8)
 * to the current version.
 *
 * Why this exists: `run_update.bat` overwrites the app's files in Inno Setup's
 * [Files] step BEFORE it runs migrations, and `migrateUp()` has no outer
 * transaction — it records each migration as it goes. So a migration that
 * throws midway leaves the app on the new build with a half-migrated database,
 * and migration 121 (`DROP TABLE product_price_levels`) is explicitly not
 * reversible. There is no clean way back; the only real safety net is knowing
 * the update will succeed before starting it.
 *
 * The one migration in 114-146 that deliberately aborts is
 * 119_backfill_base_selling_units: it throws when any two `products` rows share
 * a `barcode`. On this schema that is NORMAL data, not corruption — Verdix
 * keeps one `products` row per warehouse and `TransferStockService` copies the
 * barcode onto the sibling row, so every store that has ever transferred stock
 * trips it. This script finds those rows and separates the harmless siblings
 * (same item, two warehouses — safe to clear automatically) from genuine
 * collisions between different items, which a human has to settle.
 *
 * Run read-only:   npm run upgrade:preflight
 * Apply the fix:   npm run upgrade:preflight -- --fix
 *
 * `--fix` only ever NULLs `products.barcode` on warehouse-sibling rows, keeping
 * the barcode on one row of each group. That is the same resolution
 * `TransferStockService` already applies when it inserts a sibling's base
 * selling unit, and migration 126 later backfills a base-unit barcode from
 * `products.sku` anyway, so no scan code is lost.
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { query, closePool } from '../../lib/mysql';
import { isWarehouseSibling, type ProductIdentity } from '../../lib/product-identity';
import { getRegisteredMigrationNames } from '../migrations/runner';

const APPLY_FIX = process.argv.includes('--fix');

type ProductRow = {
  id: string;
  sku: string | null;
  name: string;
  barcode: string;
  warehouse_id: string | null;
  stock: string | number | null;
};

const toIdentity = (r: ProductRow): ProductIdentity => ({
  productId: r.id,
  sku: r.sku,
  name: r.name,
  warehouseId: r.warehouse_id,
});

function heading(text: string): void {
  console.log(`\n${'='.repeat(72)}\n${text}\n${'='.repeat(72)}`);
}

async function tableExists(table: string): Promise<boolean> {
  const rows: any = await query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(rows?.[0]?.n ?? 0) > 0;
}

/**
 * How far behind this database is. `migrations` holds one row per applied
 * migration; anything registered in the code but absent there will run during
 * the update.
 */
async function reportMigrationState(): Promise<number> {
  heading('1. MIGRATION STATE');

  if (!(await tableExists('migrations'))) {
    console.log('WARNING: no `migrations` table — this database has never been migrated.');
    console.log('         Treat it as a fresh install, not an upgrade.');
    return 0;
  }

  const applied: any = await query('SELECT name FROM migrations');
  const appliedNames = new Set(applied.map((r: any) => String(r.name)));

  // Importing the index registers every migration as a side effect; that
  // registry is the only list of what the new build will try to run.
  require('../migrations/index');
  const registered = getRegisteredMigrationNames();
  const pending = registered.filter((m) => !appliedNames.has(m));

  console.log(`Applied in this DB:    ${appliedNames.size}`);
  console.log(`Registered in code:    ${registered.length}`);
  console.log(`Pending:               ${pending.length}`);

  if (pending.length > 0) {
    console.log('\nThese will run during the update, in this order:');
    for (const name of pending) console.log(`  -> ${name}`);
  } else {
    console.log('\nOK: database is already up to date; the update applies no schema changes.');
  }

  return pending.length;
}

/**
 * The blocker. Groups products by barcode and classifies each group.
 */
async function reportDuplicateBarcodes(): Promise<{ genuine: number; siblings: number }> {
  heading('2. DUPLICATE BARCODES (blocks migration 119)');

  const dupeBarcodes: any = await query(`
    SELECT barcode FROM products
    WHERE barcode IS NOT NULL AND barcode <> ''
    GROUP BY barcode HAVING COUNT(*) > 1
  `);

  if (dupeBarcodes.length === 0) {
    console.log('OK: no duplicate barcodes. Migration 119 will not abort.');
    return { genuine: 0, siblings: 0 };
  }

  console.log(`Found ${dupeBarcodes.length} barcode(s) held by more than one product row.\n`);

  const safeToClear: { id: string; name: string; barcode: string; warehouse: string | null }[] = [];
  const siblingGroups: { barcode: string; holder: ProductRow; others: ProductRow[] }[] = [];
  const genuineGroups: { barcode: string; rows: ProductRow[] }[] = [];

  // Which warehouse a kept barcode should belong to. Any single row per group
  // satisfies migration 119, but the choice is not arbitrary: a scan should
  // resolve to the shelf the customer buys from, so the default warehouse wins.
  // `is_default` is the schema's own marker; `wh_main` is the id the installer
  // seeds, kept as a fallback for databases predating that column.
  const defaultWarehouses = new Set<string>(['wh_main']);
  if (await tableExists('warehouses')) {
    const hasIsDefault: any = await query(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouses'
         AND COLUMN_NAME = 'is_default'`
    );
    if (Number(hasIsDefault?.[0]?.n ?? 0) > 0) {
      const defaults: any = await query('SELECT id FROM warehouses WHERE is_default = 1');
      for (const w of defaults) defaultWarehouses.add(String(w.id));
    }
  }

  // Rank: default warehouse first, then any named warehouse, then rows with
  // none. `id` only ever breaks a remaining tie, so the pick is deterministic.
  const holderRank = (r: ProductRow): number => {
    if (r.warehouse_id && defaultWarehouses.has(r.warehouse_id)) return 0;
    if (r.warehouse_id) return 1;
    return 2;
  };

  for (const { barcode } of dupeBarcodes) {
    const unordered: ProductRow[] = await query(
      `SELECT id, sku, name, barcode, warehouse_id, stock
       FROM products WHERE barcode = ?`,
      [barcode]
    );
    const rows = [...unordered].sort(
      (a, b) => holderRank(a) - holderRank(b) || String(a.id).localeCompare(String(b.id))
    );

    // Keep the barcode on the first row and test every other row against it.
    // A group is only safe when EVERY other row pairs with that holder as a
    // warehouse sibling — one unrelated item sharing the barcode makes the
    // whole group a human decision.
    const [holder, ...others] = rows;
    const allSiblings = others.every((r) => isWarehouseSibling(toIdentity(r), toIdentity(holder)));

    if (allSiblings) {
      siblingGroups.push({ barcode, holder, others });
      for (const r of others) {
        safeToClear.push({ id: r.id, name: r.name, barcode: r.barcode, warehouse: r.warehouse_id });
      }
    } else {
      genuineGroups.push({ barcode, rows });
    }
  }

  if (siblingGroups.length > 0) {
    console.log(`SIBLINGS: ${safeToClear.length} row(s) are the same item on another shelf.`);
    console.log('          Safe to clear automatically. The barcode stays on the row');
    console.log('          marked KEEP (the default warehouse where available):\n');
    for (const g of siblingGroups) {
      console.log(`   barcode ${g.barcode}  (${g.holder.name})`);
      console.log(`     KEEP   ${g.holder.id}  warehouse ${g.holder.warehouse_id ?? 'none'}`);
      for (const r of g.others) {
        console.log(`     CLEAR  ${r.id}  warehouse ${r.warehouse_id ?? 'none'}`);
      }
    }
  }

  if (genuineGroups.length > 0) {
    console.log(`\nCONFLICTS: ${genuineGroups.length} barcode(s) shared by rows that are NOT siblings.`);
    console.log('           Different items, or rows with no warehouse. Resolve these by');
    console.log('           hand in the Products list before updating:\n');
    for (const g of genuineGroups) {
      console.log(`   barcode ${g.barcode}`);
      for (const r of g.rows) {
        console.log(
          `     - ${r.name}  (product ${r.id}, sku ${r.sku ?? 'none'}, ` +
            `warehouse ${r.warehouse_id ?? 'none'}, stock ${r.stock ?? 0})`
        );
      }
    }
  }

  if (APPLY_FIX && safeToClear.length > 0) {
    console.log(`\n--fix: clearing barcode on ${safeToClear.length} sibling row(s)...`);
    for (const r of safeToClear) {
      await query('UPDATE products SET barcode = NULL WHERE id = ?', [r.id]);
    }
    console.log('Done. Re-run without --fix to confirm the groups are clear.');
  } else if (safeToClear.length > 0) {
    console.log('\n   Re-run with --fix to clear these automatically.');
  }

  return { genuine: genuineGroups.length, siblings: safeToClear.length };
}

/**
 * Migration 135 widens four line-item quantity columns from INT to DECIMAL.
 * Lossless, but it rewrites each table, so the row counts set the downtime.
 */
async function reportAlterTableCost(): Promise<void> {
  heading('3. TABLE SIZES (migration 135 rewrites these)');

  const targets = ['sale_items', 'sales_invoice_items', 'sales_order_items', 'purchase_order_items'];
  for (const table of targets) {
    if (!(await tableExists(table))) {
      console.log(`  ${table.padEnd(22)} not present`);
      continue;
    }
    const rows: any = await query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    console.log(`  ${table.padEnd(22)} ${Number(rows?.[0]?.n ?? 0).toLocaleString()} rows`);
  }
  console.log('\n  ALTER TABLE locks each table while it runs. Update off-peak.');
}

/**
 * Migrations 146 and 137 change what the sidebar shows. Both are documented
 * behaviour changes rather than bugs, but the store notices them immediately,
 * so flag whether THIS install will be affected.
 */
async function reportBehaviourChanges(): Promise<void> {
  heading('4. BEHAVIOUR CHANGES ON THIS INSTALL');

  let willHidePages = true;
  if (await tableExists('disabled_pages')) {
    const rows: any = await query('SELECT COUNT(*) AS n FROM disabled_pages');
    willHidePages = Number(rows?.[0]?.n ?? 0) === 0;
  }

  if (willHidePages) {
    console.log('CHANGE: Page Visibility is unconfigured, so migration 146 WILL hide');
    console.log('        Repackaging, the Approvals Board and Workflow Settings.');
    console.log('        Re-enable them in Developer Options > Page Visibility.');
  } else {
    console.log('OK: Page Visibility already configured — migration 146 skips seeding');
    console.log('    and leaves the admin\'s choices alone.');
  }

  console.log('\nCHANGE: Migration 137 disables POS access from a plain browser. Electron');
  console.log('        terminals are unaffected. If any till runs POS through a browser');
  console.log('        over the LAN, re-enable it in Developer Options afterwards.');

  console.log('\nCHANGE: Migration 130 unions each user\'s individual permissions into');
  console.log('        their user TYPE. Additive, but a grant made to one user becomes');
  console.log('        a grant to everyone sharing that type. Review Manage User Types.');
}

async function main(): Promise<void> {
  console.log(`Verdix upgrade pre-flight — ${APPLY_FIX ? 'FIX MODE' : 'read-only'}`);
  console.log(`Database: ${process.env.DB_NAME} @ ${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}`);

  const pending = await reportMigrationState();
  const { genuine } = await reportDuplicateBarcodes();
  await reportAlterTableCost();
  await reportBehaviourChanges();

  heading('VERDICT');
  if (genuine > 0) {
    console.log('DO NOT UPDATE YET.');
    console.log(`  ${genuine} genuine barcode conflict(s) will abort migration 119 and`);
    console.log('  leave the install half-migrated. Resolve them, then re-run this.');
    process.exitCode = 1;
  } else if (pending === 0) {
    console.log('CLEAR: nothing pending. The updater applies no schema changes.');
  } else {
    console.log(`CLEAR TO UPDATE: ${pending} migration(s) will run.`);
    console.log('  Take a mysqldump first — migration 121 is not reversible.');
  }
}

main()
  .catch((error) => {
    console.error('\nPre-flight failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
    // lib/mysql pulls in lib/init-scheduler, whose cron jobs keep the event
    // loop alive, so this never exits on its own.
    process.exit(process.exitCode ?? 0);
  });
