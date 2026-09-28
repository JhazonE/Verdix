# User Type → User Permission Live Sync

## Problem

Two permission lists exist and have never been connected at read time:

- `user_type_permissions` — checkboxes edited in **Manage User Types** (`app/(app)/user-management/manage-user-types/`). Purely a label/template.
- `user_permissions` — checkboxes edited per-user in **Add/Edit User** (`UserPermissionsGrid.tsx`). This is the only table `POST /api/auth/login` (`app/api/auth/login/route.ts:54-57`) and every permission check in the app actually reads.

The only link between them today is a **one-time copy**: `use-add-user.ts:45-49` and `use-edit-user.ts:65-81` copy a type's `user_type_permissions` into the form's `permissions` field only when a user is first created, or when an admin actively switches their `userType` dropdown. After that, the two lists are fully independent. Editing a User Type's checkboxes (e.g. checking "Void Sales Invoices" on Super Admin) has zero effect on any existing user — including the account that made the edit.

This surfaced because a new `void_invoices` permission was added ([2026-09-28 void fix work]) and checking it on the "Super Admin" type in Manage User Types did nothing for the actual `admin` account.

## Goal

Make `user_type_permissions` the single live source of truth. Editing a User Type's checkboxes immediately changes what every user of that type can do — no per-user override, no reseed step.

## Current-state divergence (must not silently break on cutover)

Real DB state today:

| User | Type | Actual permissions (`user_permissions`) | Type template (`user_type_permissions`) | Divergence |
|---|---|---|---|---|
| `admin` | Super Admin | ...includes `manage_settings` | does NOT include `manage_settings` | admin would **lose** settings access |
| `rexd` | Frontliner | only `pos_frontliner` | `access_pos`, `pos_frontliner` | rexd would **gain** `access_pos` |
| `jhazonE` | Admin | exact match | exact match | none |

A naive cutover (start reading `user_type_permissions` instead of `user_permissions`) changes real access on day one. The migration step below prevents that.

## Design

### 1. Data model — no schema change

`user_permissions` (per-user table) stays in the schema but stops being read by any permission check. It becomes dead after cutover; not dropped in this pass (see Out of scope).

`user_type_permissions` becomes authoritative. `users.user_type` already stores the type's `name` (confirmed in `app/api/auth/login/route.ts:23`: `LEFT JOIN user_types ut ON u.user_type = ut.name OR u.user_type = ut.id` — it tolerates either, but every write path stores `name`).

### 2. Migration (data merge, run once)

New migration `130_merge_user_permissions_into_type.ts`:

- For every user, compute `effective = user_permissions(user) ∪ user_type_permissions(user's type)`.
- Write `effective` back into `user_type_permissions` for that user's type (union, never overwrite/remove).
- This resolves both divergence rows: Super Admin template gains `manage_settings` (from `admin`'s override), Frontliner template already has `access_pos` so `rexd` gains nothing new — no permission is ever removed from anyone.
- Where two users share a type but had different manual overrides, the type ends up with the union of both — the broader set. This is a one-way widening merge; it cannot narrow anyone's access. Flag any type where this merge changes its checkbox set > baseline so it can be reviewed (console.log, not blocking).

### 3. Backend — switch the read path

All `user_permissions` call sites found in the codebase, and what each needs:

- `app/api/auth/login/route.ts:54-57` (READ) — replace the `user_permissions` query with a join through `user_type_permissions` via `users.user_type = user_types.name`. Login response shape (`permissions: string[]`) is unchanged — only the source table changes.
- `app/api/sales/invoices/[id]/void/route.ts` (READ, added earlier for `void_invoices`) — same swap — query `user_type_permissions` via the acting user's type instead of `user_permissions` via `uid` directly.
- `app/api/users/route.ts` GET (READ, line 23) — list page's per-user permission display. Switch to joining through `user_type_permissions` so the list shows each user's *effective* (type-derived) permissions, not a stale per-user snapshot.
- `app/api/users/route.ts` POST (WRITE, lines 80-86) — stop inserting into `user_permissions` on user creation. The request body's `permissions` field is ignored (or the field is dropped from the request entirely per section 4).
- `app/api/users/[uid]/route.ts` PUT (WRITE, lines 125-137) — stop the delete+reinsert into `user_permissions` on update; same reasoning.
- `app/api/users/[uid]/route.ts` DELETE (WRITE, line 177) — the `DELETE FROM user_permissions WHERE user_uid = ?` cleanup can stay as a harmless no-op (table still exists, still has FK-less rows) or be removed; leaving it is simpler and safe.
- `app/api/data-management/reset/route.ts` (WRITE, factory-reset flow) — currently deletes/reseeds `user_permissions` rows for non-admin users. Leave as-is; harmless since the table is no longer read, but do not remove this without separately auditing the whole reset flow (out of scope here).
- `app/api/sync/pull/route.ts` / `lib/scheduler.ts:541-547` (cloud sync, READ+WRITE) — this pulls `user_permissions` rows from the Railway cloud DB into local `user_permissions` on sync. Per [[cloud-db-primary]] the cloud DB is the shared source of truth for synced tables. Leave this sync path unchanged — it keeps replicating a table that's no longer read locally, which is inert, not broken. **Do not extend sync to `user_type_permissions` in this pass** — that table is small, admin-edited, and store-specific; syncing it is a separate decision or leave it as local-first, out of scope for this fix.
- Any other route added later that checks permissions server-side must read via `user_type_permissions` — document the pattern once, inline, at the login route (comment) since that's the canonical example.

### 4. Frontend — Add/Edit User

- `UserPermissionsGrid.tsx` (used by both Add and Edit User dialogs) changes from editable checkboxes to a **read-only list** of the selected type's permissions, with a short note ("Permissions are managed per User Type — edit them in Manage User Types") and a link/button that opens `ManageUserTypesDialog` pre-scoped to the selected type if practical, otherwise just opens it.
- The `permissions` form field is no longer submitted from Add/Edit User — `POST /api/users` and `PUT /api/users/[uid]` stop accepting/writing a `permissions` array. `userType` alone determines access from then on.
- Remove the seed-on-type-change effects in `use-add-user.ts:45-49` and `use-edit-user.ts:65-81` — no longer needed since there's nothing to seed into.

### 5. Void feature defaults (the original ask)

As part of this same change, update the **Super Admin** type in `user_type_permissions` to include:
- `void_invoices` (already exists as a permission, added earlier this session)
- `pos_frontliner`

Applied as UPDATE statements inside the same migration (130), after the merge step, so Super Admin ends up with every permission in `ALL_PERMISSIONS` including these two, regardless of what the merge produced.

## Error handling

- Migration is additive/union-only — no `down()` data loss risk beyond "the extra merged permissions stay" (acceptable; documented in the migration's `down()` comment, consistent with `128`/`055`'s precedent of a best-effort revert).
- If a user's `user_type` doesn't match any row in `user_types` (orphaned/free-text type), the login join returns zero permissions for them — same failure mode as today when `user_type_permissions` has no rows for a type, so no new failure class introduced.

## Testing

- Migration: run against a DB snapshot with the current 3 users, assert `admin` still has `manage_settings` after cutover, `rexd` still has `pos_frontliner` and now also `access_pos`, `jhazonE` unchanged.
- Login route: unit-style check (via `tsx`, same approach used to debug the void route) that `admin`, `jhazonE`, `rexd` each get the expected permission list post-migration.
- Void route: repeat the three curl checks already used earlier (no uid → 401, uid whose type lacks `void_invoices` → 403, uid whose type has it → success), now driven by type membership instead of a direct `user_permissions` grant.
- Manage User Types: check/uncheck a permission on a type, confirm (without touching Add/Edit User) that a user of that type gains/loses it on next login — this is the core behavior the whole change exists to deliver.

## Out of scope

- Dropping the now-unused `user_permissions` table/writes — left in place this pass in case something else still reads it; a follow-up cleanup task once confirmed fully dead.
- Per-user exceptions to a type's permissions (e.g. "this one Cashier can also void") — the live-sync model explicitly removes this capability; if it's needed later it would be a separate additive feature (an override table layered on top), not part of this change.
- `app/(app)/use-app-layout.ts:69-75`'s `hasPermission()` frontend helper checks `user.permissions?.includes('super_admin')` as a bypass, but no real permission value `super_admin` exists anywhere in `user_type_permissions` or `ALL_PERMISSIONS` — it is dead code today and stays dead code after this change (the same `permissions[]` array it reads still comes from login, just sourced differently). Not touched here; a pre-existing inconsistency, not something this change introduces or needs to resolve.
