import { registerMigration, Migration } from './runner';
import { query } from '../../lib/mysql';
import { v4 as uuidv4 } from 'uuid';

/**
 * Seeds the `Price Inquiry` user type — the account behind the self-service
 * price-checker kiosk (`/price-check`).
 *
 * The kiosk is unattended: a customer scans a barcode themselves and sees the
 * retail price, with no cashier present. So this type holds exactly ONE
 * permission, `price_inquiry`, and nothing else. It cannot reach POS checkout,
 * the back office, stock, cost or reports.
 *
 * **The type NAME is load-bearing.** User types are DB-driven rows, but the
 * routing that pins this account to the kiosk matches on the type's name
 * string — `app/login/page.tsx` sends `Price Inquiry` to `/price-check`, and
 * `app/(app)/use-app-layout.ts` redirects it back there from anywhere else.
 * Renaming this row from the User Management UI silently unpins the kiosk and
 * drops the account onto the dashboard. That is the same convention the
 * `Cashier` → `/pos` redirect already relies on; see migration 070, which
 * seeded the original five types.
 *
 * Idempotent in both directions: `up()` checks for the row and the permission
 * separately, because a half-applied state is reachable — the user type can be
 * created from the User Management UI before this migration ever runs.
 */
const USER_TYPE_NAME = 'Price Inquiry';
const PERMISSION = 'price_inquiry';
const DESCRIPTION =
  'Self-service price-checker kiosk. Can look up a product price and nothing else.';

async function findUserTypeId(name: string): Promise<string | null> {
  const rows: any = await query('SELECT id FROM user_types WHERE name = ?', [name]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
}

async function hasPermission(userTypeId: string, permission: string): Promise<boolean> {
  const rows: any = await query(
    'SELECT id FROM user_type_permissions WHERE user_type_id = ? AND permission = ?',
    [userTypeId, permission]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const migration: Migration = {
  name: '140_add_price_inquiry_user_type',
  timestamp: '2026-10-19_12-00-00',

  async up(): Promise<void> {
    console.log('--- ADDING the Price Inquiry user type ---');

    let typeId = await findUserTypeId(USER_TYPE_NAME);

    if (typeId) {
      console.log(`⏭️  user type "${USER_TYPE_NAME}" already present, skipping`);
    } else {
      typeId = uuidv4();
      await query('INSERT INTO user_types (id, name, description) VALUES (?, ?, ?)', [
        typeId,
        USER_TYPE_NAME,
        DESCRIPTION,
      ]);
      console.log(`✅ user type "${USER_TYPE_NAME}" added`);
    }

    // Checked independently of the row above: the type may exist without its
    // permission if it was hand-created from the User Management UI.
    if (await hasPermission(typeId, PERMISSION)) {
      console.log(`⏭️  permission "${PERMISSION}" already granted, skipping`);
    } else {
      await query(
        'INSERT INTO user_type_permissions (id, user_type_id, permission) VALUES (?, ?, ?)',
        [uuidv4(), typeId, PERMISSION]
      );
      console.log(`✅ permission "${PERMISSION}" granted to "${USER_TYPE_NAME}"`);
    }

    console.log('✅ Price Inquiry kiosk accounts can now be created from User Management');
  },

  async down(): Promise<void> {
    console.log('--- DROPPING the Price Inquiry user type ---');

    const typeId = await findUserTypeId(USER_TYPE_NAME);
    if (!typeId) {
      console.log(`⏭️  user type "${USER_TYPE_NAME}" not present, skipping`);
      return;
    }

    // user_type_permissions has ON DELETE CASCADE on user_type_id (migration
    // 070), so the permission row goes with it.
    await query('DELETE FROM user_types WHERE id = ?', [typeId]);
    console.log(`✅ user type "${USER_TYPE_NAME}" dropped (permissions cascaded)`);
  },
};

registerMigration(migration);
