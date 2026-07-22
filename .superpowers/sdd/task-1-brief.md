## Task 1: Migration — schema for expiration tracking

**Files:**
- Create: `scripts/migrations/100_add_expiration_tracking.ts`
- Modify: `scripts/migrations/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `products.is_perishable` (TINYINT(1) NOT NULL DEFAULT 0), `inventory_batches.expiration_date` (DATE NULL), index `idx_ib_expiration`

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/100_add_expiration_tracking.ts`:

```typescript
import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';

/**
 * Expiration tracking for stock adjustments.
 *
 *   1. products.is_perishable — gates whether expiry inputs appear for a product.
 *      Defaults to 0, so every existing product is non-perishable until marked.
 *   2. inventory_batches.expiration_date — the source of truth. Per-batch, so a
 *      June delivery and a July delivery of the same product keep separate dates,
 *      which is what the existing FIFO deduction already assumes.
 *
 * products.expiration_date already exists (migration 052) and is retained as a
 * denormalized cache of the soonest upcoming batch expiry, so screens already
 * reading it keep working.
 *
 * Historical batches are deliberately NOT backfilled — there is no data to infer
 * an expiry from, and guessing would make the expiring-soon report lie.
 */
const migration: Migration = {
  name: '100_add_expiration_tracking',
  timestamp: '2026-07-22_12-00-00',

  async up(): Promise<void> {
    const [perishableCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = 'is_perishable'
    `);
    if (perishableCol?.cnt > 0) {
      console.log('• products.is_perishable already exists — skipping');
    } else {
      await query(`
        ALTER TABLE products
        ADD COLUMN is_perishable TINYINT(1) NOT NULL DEFAULT 0
      `);
      console.log('✅ Added products.is_perishable');
    }

    const [expiryCol]: any = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_batches'
        AND COLUMN_NAME = 'expiration_date'
    `);
    if (expiryCol?.cnt > 0) {
      console.log('• inventory_batches.expiration_date already exists — skipping');
      return;
    }

    await query(`
      ALTER TABLE inventory_batches
      ADD COLUMN expiration_date DATE NULL
    `);
    console.log('✅ Added inventory_batches.expiration_date');

    // Indexed because the expiring-soon report filters on a date range across
    // every batch in the system.
    await query(`
      CREATE INDEX idx_ib_expiration
      ON inventory_batches (expiration_date)
    `);
    console.log('✅ Added idx_ib_expiration');
  },

  async down(): Promise<void> {
    await query(`DROP INDEX idx_ib_expiration ON inventory_batches`);
    await query(`ALTER TABLE inventory_batches DROP COLUMN expiration_date`);
    console.log('✅ Dropped inventory_batches.expiration_date');

    await query(`ALTER TABLE products DROP COLUMN is_perishable`);
    console.log('✅ Dropped products.is_perishable');
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register the migration**

In `scripts/migrations/index.ts`, find the line `import './099_add_mc_number';` and add directly below it:

```typescript
import './100_add_expiration_tracking';
```

- [ ] **Step 3: Run the migration**

Run: `npm run migrate`
Expected: output contains `✅ Added products.is_perishable`, `✅ Added inventory_batches.expiration_date`, `✅ Added idx_ib_expiration`

- [ ] **Step 4: Verify the schema landed**

Run:
```bash
node -e "require('dotenv').config();const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [r]=await c.query(\"SELECT TABLE_NAME,COLUMN_NAME,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='products' AND COLUMN_NAME='is_perishable') OR (TABLE_NAME='inventory_batches' AND COLUMN_NAME='expiration_date'))\");console.table(r);await c.end();})()"
```
Expected: two rows — `products.is_perishable` (NO, `0`) and `inventory_batches.expiration_date` (YES, `NULL`).

- [ ] **Step 5: Verify rollback works, then re-apply**

Run: `npm run migrate:down`
Expected: `✅ Dropped inventory_batches.expiration_date` and `✅ Dropped products.is_perishable`

Run: `npm run migrate`
Expected: both columns re-added. This proves `down()` is correct — do not skip it.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/100_add_expiration_tracking.ts scripts/migrations/index.ts
git commit -m "feat(inventory): add expiration tracking columns

products.is_perishable gates the UI; inventory_batches.expiration_date
is the per-batch source of truth."
```

---

