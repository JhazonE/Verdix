# Developer Options — Page Enable/Disable

**Date:** 2026-07-24
**Status:** Approved design

## Problem

There is no way for an operator to hide pages they do not use. Every page in the
sidebar is always shown, and every page URL is always reachable. We want a hidden,
super-admin-only developer panel where individual pages can be toggled off. A disabled
page must (1) disappear from the sidebar and (2) redirect away if its URL is opened
directly. The example given: disabling **Sales Order** and **Sales Invoice** hides them
from the UI.

## Decisions

| Question | Decision |
|---|---|
| Disable scope | Hide from sidebar **and** block the URL (redirect to `/dashboard`). |
| Which pages | All sidebar pages (top-level + Inventory/Sales/Customers/Suppliers/Purchases sub-pages). |
| Storage | Database — shared across all terminals on the store DB. |
| Access | Super admin only. |
| Entry point | Direct URL only: `/developer/options`. No sidebar link. |
| Safety | Core pages (Dashboard, Settings, User Management, `/developer/*`) are non-toggleable. |

## Architecture

### 1. Page registry — `lib/page-registry.ts` (new)

Single source of truth for every toggleable page:

```ts
type RegistryPage = {
  key: string;        // stable id, e.g. "sales_orders" — used in storage
  href: string;       // exact route, e.g. "/sales/orders"
  label: string;      // display label
  section: string;    // grouping: "Platform" | "Sales" | "Inventory" | ...
  protected?: boolean;// true = always enabled, excluded from toggling
};
```

- Entries are derived from the existing nav config in `app/(app)/layout-nav-config.ts`
  (`navItems`, `otherNavItems`, `salesNavItems`, `inventoryNavItems`,
  `customerNavItems`, `suppliersNavItems`, `purchasesNavItems`) so the registry and the
  sidebar list the same pages.
- `key` is a hand-assigned stable slug so renaming a `label` never orphans a stored
  setting.
- Protected pages: Dashboard (`/dashboard`), Settings (`/settings`), User Management
  (`/user-management`), and anything under `/developer`. These are marked
  `protected: true` and can never be added to the disabled set.
- Helpers exported:
  - `TOGGLEABLE_PAGES` — registry filtered to `!protected`.
  - `pageKeyForHref(href): string | undefined` — reverse lookup for the URL guard.
  - `isProtectedHref(href): boolean` — defensive check in the guard.

### 2. Storage — DB table + API

**Table `disabled_pages`** — one row per disabled page:

```sql
CREATE TABLE IF NOT EXISTS disabled_pages (
  page_key VARCHAR(100) NOT NULL PRIMARY KEY,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Route `app/api/developer/disabled-pages/route.ts`:**
- `GET` → `{ success: true, disabled: string[] }` — the list of disabled page keys.
  Lazily creates the table if missing (matches the `pos-settings` route pattern).
- `POST` `{ disabled: string[] }` → replaces the full set (delete all, insert the given
  keys). Protected keys are filtered out server-side as a safety net, even if a client
  sends them.

A dedicated table (not a `pos_settings` column) is used because the set is
variable-length and this keeps it clean.

### 3. Sidebar hiding — `use-app-layout.ts`

- On mount, `GET /api/developer/disabled-pages` and store `disabledKeys: Set<string>`.
- Build the filtered nav lists against BOTH the existing permission filter AND the
  disabled set. A nav item is hidden when its href maps to a disabled key.
- The section nav lists (`salesNavItems`, etc.) are passed to `AppSidebar` already
  filtered. Expose new filtered versions from the hook (e.g. `filteredSalesNavItems`)
  rather than filtering inside `AppSidebar`, keeping the sidebar a dumb renderer.
- `AppSidebar` and the sidebar search index consume the filtered lists, so hidden pages
  also drop out of search results.

### 4. URL blocking — `(app)` layout guard

- The layout (via the hook) knows `disabledKeys`, `disabledLoaded`, and `pathname`.
- After the set has loaded, if `pageKeyForHref(pathname)` is in `disabledKeys` and the
  path is not protected, `router.replace('/dashboard')`.
- The guard waits for `disabledLoaded` to avoid redirecting an enabled page during the
  brief pre-fetch window.

### 5. Developer page — `app/(app)/developer/options/page.tsx` (client)

- **Super-admin gate:** read `mock-user-session`; if not `super_admin`, `router.replace('/dashboard')`.
- Fetch current disabled set; render `TOGGLEABLE_PAGES` grouped by `section`, each with a
  toggle `Switch` (checked = enabled). Protected pages are not rendered (or shown locked)
  — they are simply not in `TOGGLEABLE_PAGES`.
- A **Save** action POSTs the derived disabled list; on success, toast and the sidebar /
  guard pick up the change on next load. (Local component state updates immediately; a
  full effect re-fetch is not required since the source of truth is re-read on
  navigation.)

## Data flow

```
developer/options ──POST { disabled[] }──► /api/developer/disabled-pages ──► disabled_pages
                                                                                 │
use-app-layout (GET on mount) ◄──────────────────────────────────────────────────┘
      │
      ├─► filtered nav lists ─► AppSidebar  (disabled link not rendered, drops from search)
      └─► disabledKeys + pathname ─► layout guard (router.replace('/dashboard') if disabled)
```

## Edge cases

- **Loading race:** guard redirects only after `disabledLoaded`; the sidebar hides only
  after load. A brief first paint may show all links, but a *blocked* page URL is still
  caught by the guard once loaded.
- **Sub-page hrefs:** matched by exact href. Disabling `/sales/orders` does not affect
  `/sales`.
- **Protected pages:** enforced three ways — excluded from `TOGGLEABLE_PAGES`, filtered
  out server-side in POST, and skipped by the guard via `isProtectedHref`.
- **Cashier/POS users:** unaffected — they are already redirected to `/pos` and never see
  the sidebar.

## Testing

E2E (Playwright, port 3100):
1. Seed/POST `disabled: ["sales_orders"]`.
2. Load the app → assert the "Sales Order" sidebar link is absent.
3. Navigate to `/sales/orders` → assert redirect to `/dashboard`.
4. POST `disabled: []` → assert the link returns and `/sales/orders` loads.

## Out of scope

- Per-user or per-role page toggles (this is store-wide).
- Toggling protected pages.
- Any change to permissions/auth model.
