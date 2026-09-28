import { registerMigration, Migration } from './runner';
import { query, withTransaction } from '../../lib/mysql';

/**
 * user_type_permissions (Manage User Types) and user_permissions (per-user
 * grants) have never been connected at read time — see
 * docs/superpowers/specs/2026-09-28-user-type-permission-live-sync-design.md.
 * This migration is the one-time data merge that makes it safe to switch
 * every read path from user_permissions to user_type_permissions: for each
 * user, their individually-granted permissions are unioned into their
 * type's template so nobody loses access on cutover. It only ever adds
 * rows to user_type_permissions, never removes any.
 */
const migration: Migration = {
  name: '130_merge_user_permissions_into_type',
  timestamp: '2026-09-28_10-00-00',

  async up(): Promise<void> {
    const users: any[] = await query('SELECT uid, user_type FROM users');
    const types: any[] = await query('SELECT id, name FROM user_types');
    const typeIdByName = new Map(types.map((t: any) => [t.name, t.id]));

    const userPerms: any[] = await query('SELECT user_uid, permission FROM user_permissions');
    const permsByUser = new Map<string, Set<string>>();
    for (const row of userPerms) {
      if (!permsByUser.has(row.user_uid)) permsByUser.set(row.user_uid, new Set());
      permsByUser.get(row.user_uid)!.add(row.permission);
    }

    const existingTypePerms: any[] = await query('SELECT user_type_id, permission FROM user_type_permissions');
    const typePermSet = new Map<string, Set<string>>();
    for (const row of existingTypePerms) {
      if (!typePermSet.has(row.user_type_id)) typePermSet.set(row.user_type_id, new Set());
      typePermSet.get(row.user_type_id)!.add(row.permission);
    }

    const toInsert: Array<{ typeId: string; permission: string }> = [];

    for (const user of users) {
      const typeId = typeIdByName.get(user.user_type);
      if (!typeId) {
        console.warn(`⚠️  user ${user.uid} has user_type "${user.user_type}" which matches no user_types row — skipping (their permissions cannot be merged anywhere)`);
        continue;
      }
      const userOwnPerms = permsByUser.get(user.uid) || new Set();
      const currentTypePerms = typePermSet.get(typeId) || new Set();
      for (const perm of userOwnPerms) {
        if (!currentTypePerms.has(perm)) {
          toInsert.push({ typeId, permission: perm });
          currentTypePerms.add(perm);
          typePermSet.set(typeId, currentTypePerms);
        }
      }
    }

    // Seed the void-feature default onto Super Admin regardless of what the
    // merge produced. pos_frontliner is deliberately NOT included here — it
    // is a POS-mode restriction flag, not an additive capability: a user who
    // has it is blocked from normal POS checkout outside pharmacy mode, and
    // reduced to "tag orders only" inside it. Granting it to Super Admin
    // would downgrade that account's own POS access, which is the opposite
    // of what "Super Admin" should mean.
    const superAdminId = typeIdByName.get('Super Admin');
    if (superAdminId) {
      const current = typePermSet.get(superAdminId) || new Set();
      if (!current.has('void_invoices')) {
        toInsert.push({ typeId: superAdminId, permission: 'void_invoices' });
        current.add('void_invoices');
      }
      typePermSet.set(superAdminId, current);
    } else {
      console.warn('⚠️  No "Super Admin" user_types row found — void_invoices not seeded anywhere');
    }

    if (toInsert.length === 0) {
      console.log('⏭️  No permission merges needed — user_type_permissions already covers every user grant');
      return;
    }

    await withTransaction(async (connection) => {
      for (const { typeId, permission } of toInsert) {
        await connection.query(
          'INSERT INTO user_type_permissions (id, user_type_id, permission) VALUES (UUID(), ?, ?)',
          [typeId, permission]
        );
      }
    });

    console.log(`✅ merged ${toInsert.length} permission(s) into user_type_permissions:`);
    for (const { typeId, permission } of toInsert) {
      const typeName = types.find((t: any) => t.id === typeId)?.name || typeId;
      console.log(`   ${typeName}: +${permission}`);
    }
  },

  async down(): Promise<void> {
    // Best-effort only: removes the void-feature seed from Super Admin.
    // The per-user merge is not reversed — those merged permissions stay,
    // since we cannot tell which ones came from the merge vs. were already
    // there, and removing them could re-introduce the exact access loss
    // this migration exists to prevent.
    const superAdmin: any[] = await query("SELECT id FROM user_types WHERE name = 'Super Admin'");
    if (superAdmin.length > 0) {
      await query(
        "DELETE FROM user_type_permissions WHERE user_type_id = ? AND permission = 'void_invoices'",
        [superAdmin[0].id]
      );
      console.log('✅ removed void_invoices from Super Admin (merged per-user permissions were left in place)');
    }
  }
};

registerMigration(migration);
