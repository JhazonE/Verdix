# User Type → User Permission Live Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `user_type_permissions` (Manage User Types) the single live source of truth for what a user can do, replacing the current one-time-copy-then-diverge relationship with `user_permissions` (per-user grants).

**Architecture:** A migration merges each user's current effective permissions into their type (union, never removes access). Every server-side permission read (login, void route, users list) switches from querying `user_permissions` by `uid` to querying `user_type_permissions` joined through `users.user_type = user_types.name`. The Add/Edit User permission checkboxes become a read-only display of the type's permissions; only Manage User Types can change them going forward.

**Tech Stack:** Next.js 16 API routes, raw `mysql2` queries via `lib/mysql.ts`, React Hook Form on the client.

**Spec:** `docs/superpowers/specs/2026-09-28-user-type-permission-live-sync-design.md`

## Global Constraints

- Never remove a permission any real user currently has as a side effect of this change — the merge migration must be additive/union-only (per spec's Migration section).
- `user_permissions` table stays in the schema and keeps being written by `app/api/data-management/reset/route.ts` and the cloud sync pull path (`app/api/sync/pull/route.ts` / `lib/scheduler.ts`) — do not touch those two files in this plan (per spec's Out of scope).
- `users.user_type` stores the type's `name` (confirmed in the existing login route's join); all new joins use `users.user_type = user_types.name`.
- Login response shape stays `{ uid, displayName, userType, permissions: string[], ... }` — only where `permissions` is sourced from changes, not its shape.

## Review Focus

- A user whose `user_type` doesn't match any `user_types.name` row (typo'd/orphaned type) — must resolve to an empty permission list, not a crash, matching today's behavior when a type has zero rows in `user_type_permissions`.
- Two users sharing one type where one previously had an extra manual permission the other didn't — after the merge, both must end up with the same (union) permission set, since permissions no longer vary within a type.
- The void route (`app/api/sales/invoices/[id]/void/route.ts`) after this change — must keep rejecting a `uid` with no matching user/type (not silently succeed).
- Add/Edit User dialogs — submitting the form after this change must not error even though `permissions` is no longer part of the payload (API routes must tolerate the field being absent, not require it).
- Manage User Types delete flow (`DELETE /api/user-types/[id]`) — already blocks deleting a type in use by a user; must keep working since that block now matters more (deleting an in-use type would zero out those users' access).

---

## Task 1: Migration — merge user permissions into their type, seed Super Admin extras

**Files:**
- Create: `scripts/migrations/130_merge_user_permissions_into_type.ts`
- Modify: `scripts/migrations/index.ts` (add import)

**Interfaces:**
- Consumes: existing tables `users(uid, user_type)`, `user_permissions(user_uid, permission)`, `user_types(id, name)`, `user_type_permissions(id, user_type_id, permission)`.
- Produces: `user_type_permissions` rows widened to include every permission any user of that type currently has individually, plus `void_invoices` and `pos_frontliner` added to the `Super Admin` type specifically. No other task depends on this task's code, only on its data effect.

- [ ] **Step 1: Write the migration**

```typescript
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

    // Seed the void-feature defaults onto Super Admin regardless of what the merge produced.
    const superAdminId = typeIdByName.get('Super Admin');
    if (superAdminId) {
      const current = typePermSet.get(superAdminId) || new Set();
      for (const perm of ['void_invoices', 'pos_frontliner']) {
        if (!current.has(perm)) {
          toInsert.push({ typeId: superAdminId, permission: perm });
          current.add(perm);
        }
      }
      typePermSet.set(superAdminId, current);
    } else {
      console.warn('⚠️  No "Super Admin" user_types row found — void_invoices/pos_frontliner not seeded anywhere');
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
    // Best-effort only: removes the two void-feature seeds from Super Admin.
    // The per-user merge is not reversed — those merged permissions stay,
    // since we cannot tell which ones came from the merge vs. were already
    // there, and removing them could re-introduce the exact access loss
    // this migration exists to prevent.
    const superAdmin: any[] = await query("SELECT id FROM user_types WHERE name = 'Super Admin'");
    if (superAdmin.length > 0) {
      await query(
        "DELETE FROM user_type_permissions WHERE user_type_id = ? AND permission IN ('void_invoices', 'pos_frontliner')",
        [superAdmin[0].id]
      );
      console.log('✅ removed void_invoices/pos_frontliner from Super Admin (merged per-user permissions were left in place)');
    }
  }
};

registerMigration(migration);
```

- [ ] **Step 2: Register it in the migration index**

Add this line after `import './129_add_voided_status_to_sales_invoices';` in `scripts/migrations/index.ts`:

```typescript
import './130_merge_user_permissions_into_type';
```

- [ ] **Step 3: Run the migration and verify the merge against real data**

Run: `npm run migrate`

Then verify with the mysql client (adjust password flag to your local `.env`):

```bash
mysql -h127.0.0.1 -P3306 -uroot -p"$DB_PASS" verdix -e "
SELECT ut.name, GROUP_CONCAT(utp.permission ORDER BY utp.permission) AS perms
FROM user_types ut LEFT JOIN user_type_permissions utp ON ut.id = utp.user_type_id
WHERE ut.name IN ('Super Admin','Admin','Frontliner')
GROUP BY ut.id;
"
```

Expected: `Super Admin` now includes `manage_settings`, `void_invoices`, and `pos_frontliner` in addition to everything it had before. `Frontliner` unchanged (already had `access_pos`). `Admin` unchanged (already matched exactly).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/130_merge_user_permissions_into_type.ts scripts/migrations/index.ts
git commit -m "migrate: merge per-user permissions into their type, seed Super Admin void/frontliner access"
```

---

## Task 2: Switch login route to read permissions from the user's type

**Files:**
- Modify: `app/api/auth/login/route.ts:54-57`
- Test: manual, via the running dev server (this route has no existing test file; matches the codebase's current testing posture for auth routes)

**Interfaces:**
- Consumes: `users.user_type`, `user_types(id, name)`, `user_type_permissions(user_type_id, permission)` — same tables Task 1 populated.
- Produces: login response `permissions: string[]` — unchanged shape, new source. Task 4 (void route) and Task 5 (users list) follow this exact join pattern.

- [ ] **Step 1: Replace the permissions query**

In `app/api/auth/login/route.ts`, replace:

```typescript
        // Fetch permissions
        const permissions = await query(
            'SELECT permission FROM user_permissions WHERE user_uid = ?',
            [user.uid]
        ) as any[];

        const userPermissions = permissions.map((p: any) => p.permission);
```

with:

```typescript
        // Permissions live on the user's TYPE now, not per-user — see
        // docs/superpowers/specs/2026-09-28-user-type-permission-live-sync-design.md.
        // Editing a type in Manage User Types changes every user of that
        // type's access on their next login.
        const permissions = await query(
            `SELECT utp.permission
             FROM users u
             JOIN user_types ut ON u.user_type = ut.name
             JOIN user_type_permissions utp ON utp.user_type_id = ut.id
             WHERE u.uid = ?`,
            [user.uid]
        ) as any[];

        const userPermissions = permissions.map((p: any) => p.permission);
```

- [ ] **Step 2: Verify manually against the three real users**

Run (dev server must be running on port 3000):

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"<real password>"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.permissions.sort())})"
```

Expected: includes `manage_settings`, `void_invoices`, `pos_frontliner` for `admin` (Super Admin type). If you don't know the real password, instead verify via the same `tsx`-based approach used earlier in this session — write a throwaway script that calls the same query directly against `lib/mysql.ts` for `uid='mock-admin-01'` and inspect the returned rows, then delete the script.

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/login/route.ts
git commit -m "fix: read login permissions from user's type instead of per-user grants"
```

---

## Task 3: Switch the sales invoice void route to the same join

**Files:**
- Modify: `app/api/sales/invoices/[id]/void/route.ts`

**Interfaces:**
- Consumes: same `users`/`user_types`/`user_type_permissions` join as Task 2.
- Produces: nothing new consumed elsewhere; this closes out the `void_invoices` permission work from earlier in this session so it's consistent with the new model.

- [ ] **Step 1: Replace the permission check**

Current code (added earlier this session):

```typescript
    const permissions: any = await query('SELECT permission FROM user_permissions WHERE user_uid = ?', [uid]);
    const canVoid = permissions.some((p: any) => p.permission === 'void_invoices');
```

Replace with:

```typescript
    const permissions: any = await query(
        `SELECT utp.permission
         FROM users u
         JOIN user_types ut ON u.user_type = ut.name
         JOIN user_type_permissions utp ON utp.user_type_id = ut.id
         WHERE u.uid = ?`,
        [uid]
    );
    const canVoid = permissions.some((p: any) => p.permission === 'void_invoices');
```

- [ ] **Step 2: Re-run the three-case verification from the original void-permission work**

Using a disposable test invoice (same pattern as earlier this session — insert into `sales_invoices`/`sales_invoice_items` for a real product, curl the void endpoint, then delete the test rows and restore the product's stock):

1. No `uid` in body → expect `{"success":false,"error":"Not authenticated"}`, HTTP 401.
2. `uid` of a user whose type lacks `void_invoices` (e.g. `jhazonE`, Admin type, confirm via the Step 3 query in Task 1 that `Admin` doesn't have it) → expect `{"success":false,"error":"You do not have permission to void invoices"}`, HTTP 403.
3. `uid` of `mock-admin-01` (Super Admin, now has `void_invoices` from Task 1's migration) → expect `{"success":true,...}`.

Clean up all test data (test invoice, test invoice items, any `stock_movements`/`inventory_batches` rows the successful void created, restore the product's `stock` value) the same way it was done earlier in this session — do not leave test rows in the database.

- [ ] **Step 3: Commit**

```bash
git add app/api/sales/invoices/[id]/void/route.ts
git commit -m "fix: check void_invoices permission via user's type instead of per-user grant"
```

---

## Task 4: Switch the users list (GET /api/users) to show effective type-derived permissions

**Files:**
- Modify: `app/api/users/route.ts:17-47` (GET handler)

**Interfaces:**
- Consumes: same join pattern as Tasks 2–3.
- Produces: `GET /api/users` response items keep the same shape (`{ uid, username, email, userType, displayName, photoURL, disabled, creationTime, permissions: string[] }`) — `permissions` now reflects the type, not stale per-user rows. Task 6 (frontend) relies on this field still being present and correctly populated for the read-only display.

- [ ] **Step 1: Replace the permissions fetch and grouping**

Replace:

```typescript
    // Fetch permissions for each user
    const permissions = await query('SELECT user_uid, permission FROM user_permissions');

    // Group permissions by user
    const permissionsByUser = (permissions || []).reduce((acc: any, curr: any) => {
      if (!acc[curr.user_uid]) acc[curr.user_uid] = [];
      acc[curr.user_uid].push(curr.permission);
      return acc;
    }, {});

    // Map users with their permissions
    const usersWithPermissions = (users || []).map((user: any) => ({
      ...user,
      disabled: !!user.disabled,
      permissions: permissionsByUser[user.uid] || [],
    }));
```

with:

```typescript
    // Permissions are derived from each user's TYPE now (Manage User
    // Types), not stored per-user — see
    // docs/superpowers/specs/2026-09-28-user-type-permission-live-sync-design.md.
    const typePermRows: any[] = await query(`
      SELECT ut.name AS typeName, utp.permission
      FROM user_types ut
      JOIN user_type_permissions utp ON utp.user_type_id = ut.id
    `);

    const permissionsByType = typePermRows.reduce((acc: any, curr: any) => {
      if (!acc[curr.typeName]) acc[curr.typeName] = [];
      acc[curr.typeName].push(curr.permission);
      return acc;
    }, {});

    // Map users with their effective (type-derived) permissions
    const usersWithPermissions = (users || []).map((user: any) => ({
      ...user,
      disabled: !!user.disabled,
      permissions: permissionsByType[user.userType] || [],
    }));
```

Note: the raw SQL aliases the column `user_type as userType` earlier in this function (line 20, unchanged) — `user.userType` here refers to that alias, matching what the existing code already does elsewhere in this file (e.g. the POST handler's response).

- [ ] **Step 2: Verify manually**

With the dev server running:

```bash
curl -s http://localhost:3000/api/users | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);j.forEach(u=>console.log(u.username, u.userType, u.permissions.sort()))})"
```

Expected: `admin`'s permissions list includes `void_invoices`, `pos_frontliner`, `manage_settings`; `jhazonE`'s and `rexd`'s lists match their type's `user_type_permissions` (verify against the Task 1 Step 3 query output).

- [ ] **Step 3: Commit**

```bash
git add app/api/users/route.ts
git commit -m "fix: derive user list permissions from user type instead of per-user grants"
```

---

## Task 5: Stop writing to user_permissions from user create/update, keep request bodies tolerant

**Files:**
- Modify: `app/api/users/route.ts:49-108` (POST handler)
- Modify: `app/api/users/[uid]/route.ts:1-66` (PUT handler)

**Interfaces:**
- Consumes: nothing new.
- Produces: POST/PUT no longer write `user_permissions` rows; both still accept (and ignore) a `permissions` field in the request body so Task 6's frontend change can land independently without a strict two-sided deploy — if the field is present it's simply not used, if it's absent nothing breaks either.

- [ ] **Step 1: Remove the permissions insert in POST /api/users**

In `app/api/users/route.ts`, inside the `POST` handler's `withTransaction` block, remove:

```typescript
      // Insert permissions
      if (permissions && permissions.length > 0) {
        for (const permission of permissions) {
          await connection.execute(
            'INSERT INTO user_permissions (id, user_uid, permission) VALUES (?, ?, ?)',
            [uuidv4(), uid, permission]
          );
        }
      }
```

Leave the response body's `permissions: permissions || []` as-is for now — it echoes back whatever the client sent (Task 6 will stop sending anything meaningful there); this is harmless since nothing downstream trusts this echoed value as authoritative (the real value always comes from a fresh `GET /api/users` or login, both fixed in Tasks 2/4).

- [ ] **Step 2: Remove the permissions insert in PUT /api/users/[uid]**

In `app/api/users/[uid]/route.ts`, inside the `PUT` handler's `withTransaction` block, remove:

```typescript
      // Update permissions
      // Delete existing permissions for this user
      await connection.execute('DELETE FROM user_permissions WHERE user_uid = ?', [uid]);

      // Insert new permissions
      if (permissions && permissions.length > 0) {
        for (const permission of permissions) {
          await connection.execute(
            'INSERT INTO user_permissions (id, user_uid, permission) VALUES (?, ?, ?)',
            [uuidv4(), uid, permission]
          );
        }
      }
```

The `permissions` destructured from the request body (line 14) becomes unused in this handler — remove it from the destructuring too: change `const { username, password, userType, permissions, displayName } = body;` to `const { username, password, userType, displayName } = body;`.

Do the same unused-variable cleanup in `app/api/users/route.ts`'s POST handler: change `const { password, userType, permissions, displayName } = body;` to `const { password, userType, displayName } = body;`, and remove `permissions: permissions || [],` from the response object, replacing it with nothing (the field simply won't be in the POST response — Task 6's frontend doesn't read it from the create response, only from the subsequent list refetch).

- [ ] **Step 3: Typecheck the two touched files**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "api/users/route.ts|api/users/\[uid\]/route.ts"`

Expected: no output (no new type errors introduced).

- [ ] **Step 4: Verify create and update still work end-to-end**

```bash
# Create
curl -s -X POST http://localhost:3000/api/users -H "Content-Type: application/json" -d '{"username":"plan-test-user","password":"Test1234!","userType":"Staff","displayName":"Plan Test User"}'
```

Expected: `{"uid":"...","username":"plan-test-user",...}` with HTTP 200, and no error about `permissions`.

```bash
# Confirm no row landed in user_permissions for this user
mysql -h127.0.0.1 -P3306 -uroot -p"$DB_PASS" verdix -e "SELECT * FROM user_permissions WHERE user_uid = (SELECT uid FROM users WHERE username='plan-test-user');"
```

Expected: empty result set.

```bash
# Clean up the test user
mysql -h127.0.0.1 -P3306 -uroot -p"$DB_PASS" verdix -e "DELETE FROM users WHERE username='plan-test-user';"
```

- [ ] **Step 5: Commit**

```bash
git add app/api/users/route.ts "app/api/users/[uid]/route.ts"
git commit -m "fix: stop writing user_permissions on user create/update"
```

---

## Task 6: Make the Add/Edit User permissions grid read-only, remove the seed-on-type-change effects

**Files:**
- Modify: `app/(app)/user-management/UserPermissionsGrid.tsx`
- Modify: `app/(app)/user-management/add-user/use-add-user.ts`
- Modify: `app/(app)/user-management/edit-user/use-edit-user.ts`

**Interfaces:**
- Consumes: `userTypes` array already fetched by both `use-add-user.ts` and `use-edit-user.ts` (shape: `{ id, name, description, permissions: string[] }[]`, from `GET /api/user-types`, unchanged by this plan).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Rewrite `UserPermissionsGrid.tsx` as a read-only display**

Replace the full file:

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { ALL_PERMISSIONS } from './permissions';
import { UseFormReturn } from 'react-hook-form';

type Props = {
  form: UseFormReturn<any>;
};

export function UserPermissionsGrid({ form }: Props) {
  const watchedUserType = form.watch('userType');
  const permissions: string[] = form.watch('permissions') || [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Permissions are set per User Type now — edit them from{' '}
        <span className="font-medium">User Management → User Types</span>.
        {watchedUserType ? ` Showing what "${watchedUserType}" currently grants.` : ' Select a user type to see its permissions.'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4 rounded-xl bg-muted/20 border border-muted-foreground/10">
        {ALL_PERMISSIONS.filter(p => permissions.includes(p.id)).map(permission => (
          <Badge key={permission.id} variant="secondary" className="justify-start font-normal">
            {permission.label}
          </Badge>
        ))}
        {permissions.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2">No permissions for this type.</p>
        )}
      </div>
    </div>
  );
}
```

Note: `disabledForCashier` prop is dropped — it no longer makes sense once checkboxes are gone (there's nothing to disable). Task's Step 2/3 below remove the prop from both callers.

- [ ] **Step 2: Update `use-add-user.ts` to stop treating `permissions` as user-editable**

The existing effect that seeds `permissions` when the type changes already does what's needed for *display* purposes (it still needs to show the newly-selected type's permissions) — keep it, but it's no longer "seeding an editable field," it's "populating the read-only display." No code change needed for the effect itself (lines 45-49 stay exactly as they are); only the submit payload changes.

In the `onSubmit` function, remove `permissions: values.permissions,` from the request body sent to `POST /api/users`:

```typescript
      const response = await fetch(getApiUrl('/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: values.fullName,
          username: values.username,
          email: values.username,
          password: values.password,
          userType: values.userType,
        }),
      });
```

- [ ] **Step 3: Update `use-edit-user.ts` the same way**

Keep the type-change-triggers-display-refresh effect (lines 66-81) as-is — same reasoning as Step 2. In `onSubmit`, remove `permissions: values.permissions,` from the request body sent to `PUT /api/users/[uid]`:

```typescript
      const response = await fetch(getApiUrl(`/users/${user.uid}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: values.username,
          displayName: values.displayName,
          password: values.password,
          userType: values.userType,
        }),
      });
```

- [ ] **Step 4: Update the two dialog components that pass `disabledForCashier` to `UserPermissionsGrid`**

In `app/(app)/user-management/add-user/AddUserDialog.tsx`, change:

```tsx
                  <UserPermissionsGrid form={form} disabledForCashier />
```

to:

```tsx
                  <UserPermissionsGrid form={form} />
```

Check `app/(app)/user-management/edit-user/EditUserDialog.tsx` for the same `<UserPermissionsGrid ... />` usage and remove any `disabledForCashier` prop there too if present (read the file first to confirm the exact prop list before editing, since it may already omit it).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "UserPermissionsGrid|use-add-user|use-edit-user|AddUserDialog|EditUserDialog"`

Expected: no output.

- [ ] **Step 6: Manual UI verification**

Start the dev server if not already running (`npm run dev`), then in the browser:

1. Go to User Management → Add User. Pick a user type from the dropdown. Confirm the right-hand panel now shows a read-only list of badges (that type's permissions), not checkboxes.
2. Switch the user type dropdown to a different type. Confirm the badge list updates to the new type's permissions.
3. Create a user this way, confirm it succeeds (matches Task 5 Step 4's verification, just through the UI this time).
4. Open Edit User on an existing user. Confirm the same read-only badge display appears, populated with that user's current type's permissions.
5. Go to User Management → User Types → edit "Staff" (or any low-stakes type), check one new permission box, save. Confirm the "Staff" row's permission count badge updates. Then open Edit User for a user of that type — confirm the new permission now shows in their read-only badge list without you having touched that user directly. This is the core behavior the whole plan exists to deliver.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/user-management/UserPermissionsGrid.tsx" "app/(app)/user-management/add-user/use-add-user.ts" "app/(app)/user-management/edit-user/use-edit-user.ts" "app/(app)/user-management/add-user/AddUserDialog.tsx" "app/(app)/user-management/edit-user/EditUserDialog.tsx"
git commit -m "feat: make Add/Edit User permissions display read-only, driven by user type"
```

---

## Final Verification

- [ ] Run `npx tsc --noEmit -p .` for the full repo and confirm no NEW errors versus the pre-existing red baseline (per project memory, the baseline is already red — compare file lists, not raw pass/fail).
- [ ] Log in as `admin`, `jhazonE` (if password known) and confirm dashboard/nav access matches what Task 1's migration output showed for their type.
- [ ] Confirm the Sales Invoices "Void" menu item is visible for `admin` (Super Admin now has `void_invoices`) and hidden for a user whose type lacks it.
- [ ] Confirm no leftover test data remains in `sales_invoices`, `sales_invoice_items`, `stock_movements`, `inventory_batches`, or `users` from any of this plan's verification steps.
