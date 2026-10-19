# Price Inquiry Kiosk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Price Inquiry` user type whose accounts land on a fullscreen, scanner-driven `/price-check` kiosk that shows a product's retail price and nothing else.

**Architecture:** A new migration seeds the user type and its single permission. Login and the `(app)` layout gate route this type to `/price-check` and keep it there, reusing the exact mechanism that already pins `Cashier` to `/pos` — including the layout's chrome-free bypass. The page is a new client component tree under `app/(app)/price-check/`, consuming the existing `useProducts` hook and `calculateEffectivePrice` so price resolution matches POS.

**Tech Stack:** Next.js 16 (app router, client components), TypeScript, React, Tailwind + shadcn/ui, raw `mysql2` migrations, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-10-19-price-inquiry-kiosk-design.md`

## Global Constraints

- User type name is exactly `Price Inquiry` — routing matches on this string, so it must be identical in the migration and in both routing checks.
- Permission id is exactly `price_inquiry`; label `Price Inquiry (Kiosk)`.
- Route is exactly `/price-check`.
- Idle auto-clear is **10 seconds**.
- Price comes from `calculateEffectivePrice(product, 1, defaultLevelId, defaultLevelId)` in `lib/pricing.ts` — quantity is always 1, and the active level is always the default level. Never compute a price locally.
- The screen must never display stock, cost, margin, or supplier.
- No logout control of any kind on the kiosk screen.
- Migrations are registered by adding an `import './NNN_name';` line to `scripts/migrations/index.ts`, and every migration defines both `up()` and `down()` and must be idempotent (check before mutating), per `scripts/migrations/139_add_discount_auth.ts`.

## Review Focus

Input classes the spec implies but which no task's happy path exercises. Each has its test assigned to the task that owns the code.

1. **A product whose base selling unit has no price-level override** — must fall back to the unit's own `price`, never another unit's price. (Task 3)
2. **A barcode scan matching no product** — must show a clear "not found" state and stay ready for the next scan, not blank out or hang. (Task 4)
3. **A scan arriving while a previous result is still displayed** — the second scan must replace the first, not append or be ignored. (Task 4)
4. **A `Price Inquiry` user typing a back-office URL directly** — must be redirected to `/price-check`, not render inventory for one frame. (Task 2)
5. **A product with multiple selling units** — must show the base unit's price, not the first or cheapest unit's. (Task 3)

---

### Task 1: Migration + permission for the `Price Inquiry` user type

**Files:**
- Create: `scripts/migrations/140_add_price_inquiry_user_type.ts`
- Modify: `scripts/migrations/index.ts` (add import after the `139` line)
- Modify: `app/(app)/user-management/permissions.ts` (add to `ALL_PERMISSIONS`)

**Interfaces:**
- Consumes: `registerMigration`, `Migration` from `./runner`; `query` from `../../lib/mysql`.
- Produces: a `user_types` row named `Price Inquiry` with one `user_type_permissions` row for `price_inquiry`; the `price_inquiry` entry in `ALL_PERMISSIONS`.

- [ ] **Step 1: Add the permission entry**

In `app/(app)/user-management/permissions.ts`, add to `ALL_PERMISSIONS`:

```ts
{ id: 'price_inquiry', label: 'Price Inquiry (Kiosk)' },
```

- [ ] **Step 2: Write the migration**

Create `scripts/migrations/140_add_price_inquiry_user_type.ts` exporting a `Migration` with `name: '140_add_price_inquiry_user_type'` and a `timestamp`, registered via `registerMigration`.

`up()` must: select `user_types` where `name = 'Price Inquiry'`; if absent, insert one with a `uuidv4()` id and a description explaining it is the self-service kiosk type; then insert the `price_inquiry` row into `user_type_permissions` for that id, guarded so a re-run does not violate the `unique_user_type_permission` key. Log each action and each skip, following 139's style.

`down()` must delete the `user_types` row by name — the `ON DELETE CASCADE` on `user_type_permissions` removes the permission row — and skip cleanly if it is already gone.

Include a header comment explaining why the type name is load-bearing (routing matches the name string).

- [ ] **Step 3: Register the migration**

Add `import './140_add_price_inquiry_user_type';` to `scripts/migrations/index.ts` immediately after the `139` import.

- [ ] **Step 4: Run the migration and verify it is idempotent**

Run: `npm run migrate`
Expected: logs the user type and permission being added.
Run `npm run migrate` a second time.
Expected: logs skips, no error, no duplicate row.

- [ ] **Step 5: Verify the seeded row**

Write a throwaway `tsx` script in the scratchpad that imports `query` from `lib/mysql` and runs:

```sql
SELECT ut.name, utp.permission
FROM user_types ut
LEFT JOIN user_type_permissions utp ON utp.user_type_id = ut.id
WHERE ut.name = 'Price Inquiry'
```

Run it with `npx tsx <path>`. Expected: exactly one row, `Price Inquiry` / `price_inquiry`. Importing `lib/mysql` starts the scheduler's cron workers, so the script will not exit on its own — run it with a timeout and read the printed rows. Delete the script afterwards; do not commit it.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/140_add_price_inquiry_user_type.ts scripts/migrations/index.ts "app/(app)/user-management/permissions.ts"
git commit -m "feat: add Price Inquiry user type and permission"
```

---

### Task 2: Route and pin the `Price Inquiry` user type

**Files:**
- Modify: `app/login/page.tsx` (the redirect branch at ~line 96)
- Modify: `app/(app)/use-app-layout.ts` (`isPOSPage` ~line 27, the Cashier redirect ~line 79, `hasPermission` ~line 83)
- Modify: `app/(app)/layout.tsx` (the `if (isPOSPage) return <>{children}</>` bypass at ~line 77)
- Test: `tests/e2e/price-check-routing.spec.ts`

**Interfaces:**
- Consumes: `user.userType` from the `mock-user-session` localStorage payload; `mockLoginEndpoint` and the `SessionUser` type from `tests/e2e/helpers/auth.ts`.
- Produces: `isChromelessPage` in `use-app-layout.ts` — a boolean, true for POS pages and `/price-check` — replacing the bare `isPOSPage` checks that gate chrome and background fetches. `isPOSPage` keeps its current meaning (POS only) because `browserPosBlocked` depends on it.

- [ ] **Step 1: Write the failing E2E tests**

Create `tests/e2e/price-check-routing.spec.ts`. Use `mockLoginEndpoint` with a `Price Inquiry` user (permissions `['price_inquiry']`), then:

```ts
test('a Price Inquiry login lands on /price-check', async ({ page }) => {
  // mock login as userType 'Price Inquiry', submit the login form
  await expect(page).toHaveURL(/\/price-check/);
});

test('a Price Inquiry user typing a back-office URL is sent back to /price-check', async ({ page }) => {
  // seed the session, then page.goto('/products')
  await expect(page).toHaveURL(/\/price-check/);
});

test('the kiosk screen renders no sidebar and no logout control', async ({ page }) => {
  // seed the session, goto /price-check
  await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /log ?out|sign ?out/i })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- price-check-routing`
Expected: FAIL — `/price-check` does not exist yet (404 / wrong URL).

- [ ] **Step 3: Add the login redirect**

In `app/login/page.tsx`, extend the post-login branch so `result.userType === 'Price Inquiry'` pushes `/price-check`, before the existing `Cashier`/`Employee` check.

- [ ] **Step 4: Add the pin and the chrome bypass**

In `app/(app)/use-app-layout.ts`:
- Add `const isChromelessPage = isPOSPage || pathname === '/price-check';` beside the existing `isPOSPage`, and use `isChromelessPage` in place of `isPOSPage` in the three early-return guards (user loading, disabled-pages fetch) — but leave the `browserPosBlocked` computation keyed on `isPOSPage`.
- In the redirect effect, send a `Price Inquiry` user to `/price-check` whenever `pathname !== '/price-check'`, alongside the existing Cashier rule.
- In `hasPermission`, return `permission === 'price_inquiry'` for this user type, mirroring the Cashier line.
- Return `isChromelessPage` from the hook.

In `app/(app)/layout.tsx`, change the chrome bypass to `if (isChromelessPage) return <>{children}</>;` and destructure `isChromelessPage` from the hook.

- [ ] **Step 5: Add a placeholder page so the route resolves**

Create `app/(app)/price-check/page.tsx` as a client component rendering a fullscreen `<div>` with the idle text `I-scan ang barcode`. Task 4 replaces its contents.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:e2e -- price-check-routing`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no NEW errors versus the pre-existing baseline — the baseline is red, so compare against `git stash`-ed output if unsure.

- [ ] **Step 8: Commit**

```bash
git add "app/login/page.tsx" "app/(app)/use-app-layout.ts" "app/(app)/layout.tsx" "app/(app)/price-check/page.tsx" tests/e2e/price-check-routing.spec.ts
git commit -m "feat: route Price Inquiry users to a chrome-free /price-check"
```

---

### Task 3: Kiosk price resolution

**Files:**
- Create: `lib/kiosk-price.ts` (the pure resolver — **not** under `app/`, and with no `'use client'`, so a bare `tsx` unit test can import it)
- Create: `app/(app)/price-check/use-price-check.ts`
- Create: `app/(app)/price-check/price-check-types.ts`
- Test: `tests/unit/price-check-resolution.test.ts`
- Modify: `tests/unit/run.ts` (add the import — the runner is a barrel and will not pick the file up otherwise)

**Why the resolver lives in `lib/`:** this repo's unit tests are plain `tsx` scripts with no React runtime, so they cannot import a `'use client'` module — the existing `(app)`-facing unit tests work around this by reading the file as *text* and asserting on source, which is brittle. Putting the pure function in `lib/kiosk-price.ts` lets the test call it for real. `lib/pricing.ts` is already client-safe (no `lib/mysql` import), so this adds no server-only dependency.

**Interfaces:**
- Consumes: `useProducts(search?)` from `hooks/use-api` (returns `{ products, loading, error, refetch }`; already calls `useLiveRefresh` internally, so do **not** subscribe again); `calculateEffectivePrice` from `lib/pricing`; `Product` from `lib/types`.
- Produces:
  - `lib/kiosk-price.ts`: `export type KioskResult = { product: Product; price: number; unitName: string; barcode: string };` and `export function resolveKioskPrice(product: Product, defaultLevelId: string): KioskResult`. The type is declared here, beside the function that returns it, so `lib/` never imports from `app/`.
  - `price-check-types.ts`: re-exports the type for the UI — `export type { KioskResult } from '@/lib/kiosk-price';` — plus any props types Task 4 needs.
  - `use-price-check.ts`: `export function usePriceCheck(): { searchTerm: string; setSearchTerm: (s: string) => void; result: KioskResult | null; candidates: Product[]; notFound: boolean; loading: boolean; select: (productId: string) => void; clear: () => void }`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/price-check-resolution.test.ts`. **This repo's unit tests are not a framework** — they are bare `node:assert/strict` calls that self-execute on import and end with a `console.log('✓ … tests passed')` line (see `tests/unit/cart-quantity-format.test.ts`). Follow that shape exactly:

```ts
import assert from 'node:assert/strict';
import { resolveKioskPrice } from '../../lib/kiosk-price';

// Review Focus #1 — a base unit with no level override falls back to its own
// price, never another unit's and never a computed multiple of one.
assert.equal(resolveKioskPrice(noOverride, 'retail-level').price, 89, 'falls back to the unit own price');

// Review Focus #5 — base = Piece @ 17, non-base = Case @ 1020. The kiosk
// quotes what an ordinary customer buys.
const multi = resolveKioskPrice(multiUnit, 'retail-level');
assert.equal(multi.price, 17, 'returns the BASE unit price');
assert.equal(multi.unitName, 'Piece', 'names the base unit');

// A default-level override on the base unit wins over the unit's own price.
assert.equal(resolveKioskPrice(withOverride, 'retail-level').price, 85, 'default-level override applies');

assert.equal(resolveKioskPrice(noOverride, 'retail-level').barcode, '4800016641116', 'reports the base unit barcode');

console.log('✓ price-check-resolution tests passed');
```

Build each `Product` fixture inline in the file as a plain object literal.

- [ ] **Step 2: Register the test and run it to verify it fails**

Add `import './price-check-resolution.test';` to `tests/unit/run.ts`.

Run: `npm run test:unit`
Expected: FAIL — the import of `resolveKioskPrice` throws because the module does not exist yet. Note the baseline: some unit tests are already red (see the repo's known pre-existing failures), so confirm the failure names this file.

- [ ] **Step 3: Implement `resolveKioskPrice`**

In `lib/kiosk-price.ts`, declare `KioskResult` and implement `resolveKioskPrice(product, defaultLevelId)`: find the base selling unit (`sellingUnits?.find(su => su.isBase)`), take `calculateEffectivePrice(product, 1, defaultLevelId, defaultLevelId)` as the price, and read `unitName` from the base unit's `name` (falling back to `product.unitOfMeasure`) and `barcode` from the base unit's `barcode` (falling back to `product.barcode`), matching the fallback chain already used in `PriceInquiryDialog.tsx`. No `'use client'` directive in this file.

- [ ] **Step 4: Implement `usePriceCheck`**

In `app/(app)/price-check/use-price-check.ts` (a `'use client'` module), implement the hook: hold `searchTerm` state, pass it to `useProducts(searchTerm)`, fetch price levels once from `GET /api/price-levels` and derive `defaultLevelId` as `priceLevels.find(l => l.isDefault)?.id || 'retail-level'` (the same expression `use-pos.ts:604` uses). Expose `candidates` as the fetched products, `result` as the resolved selection via `resolveKioskPrice`, `notFound` as true when a non-empty search finished loading with zero products, and `select`/`clear` to set and reset the selection. Auto-select when exactly one product comes back and the search term matched a selling-unit barcode exactly.

Create `price-check-types.ts` re-exporting `KioskResult`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: the line `✓ price-check-resolution tests passed` appears. Pass markers vary across this suite (`✓`/`✅`/`passed`) and the run may hang on `lib/mysql`'s scheduler side effect — use a timeout and treat the printed pass line as the signal, not the exit code.

- [ ] **Step 6: Commit**

```bash
git add lib/kiosk-price.ts "app/(app)/price-check/use-price-check.ts" "app/(app)/price-check/price-check-types.ts" tests/unit/price-check-resolution.test.ts tests/unit/run.ts
git commit -m "feat: add kiosk price resolution for /price-check"
```

---

### Task 4: The kiosk screen

**Files:**
- Modify: `app/(app)/price-check/page.tsx` (replace the Task 2 placeholder)
- Create: `app/(app)/price-check/PriceCheckScreen.tsx`
- Test: `tests/e2e/price-check-kiosk.spec.ts`

**Interfaces:**
- Consumes: `usePriceCheck` and `KioskResult` from Task 3; `QueryClientProvider` + a module-level `QueryClient` (the pattern `app/(app)/pos/page.tsx` uses, required because the chrome-free bypass skips the layout's provider).
- Produces: the rendered kiosk screen. No exports consumed by later tasks.

- [ ] **Step 1: Write the failing E2E tests**

Create `tests/e2e/price-check-kiosk.spec.ts`. Seed a `Price Inquiry` session and stub `GET /api/products` and `GET /api/price-levels` via `page.route`:

```ts
test('shows the idle prompt before any scan', async ({ page }) => {
  await expect(page.getByText(/I-scan ang barcode/i)).toBeVisible();
});

test('an exact barcode scan shows the product name and its retail price', async ({ page }) => {
  // type the barcode into the focused input + press Enter
  await expect(page.getByText('Coca-Cola 1.5L')).toBeVisible();
  await expect(page.getByText(/₱89\.00/)).toBeVisible();
});

test('never shows stock or cost', async ({ page }) => {
  // after a successful scan
  await expect(page.getByText(/stock|cost|on hand/i)).toHaveCount(0);
});

// Review Focus #2
test('an unknown barcode shows a not-found state and stays ready', async ({ page }) => {
  await expect(page.getByText(/wala.*nakit|not found/i)).toBeVisible();
  await expect(page.locator('input')).toBeFocused();
});

// Review Focus #3
test('a second scan replaces the first result', async ({ page }) => {
  // scan A, then scan B
  await expect(page.getByText('Product B')).toBeVisible();
  await expect(page.getByText('Product A')).toHaveCount(0);
});

test('returns to the idle prompt after the idle timeout', async ({ page }) => {
  // scan, then wait out the 10s timer
  await expect(page.getByText(/I-scan ang barcode/i)).toBeVisible({ timeout: 15000 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:e2e -- price-check-kiosk`
Expected: FAIL — the placeholder renders only the idle text, so the scan tests fail.

- [ ] **Step 3: Implement `PriceCheckScreen`**

Create `app/(app)/price-check/PriceCheckScreen.tsx`, a client component consuming `usePriceCheck()`:

- Root: `flex h-screen w-screen flex-col` on a dark background, large type.
- A search `<input>` pinned at the top, `autoFocus`, refocused via a ref in an effect after every result change and after every clear, so a scanner always reaches it. No visible logout control anywhere.
- Centre region switching on state: idle prompt (`I-scan ang barcode` with an English subline), the resolved result (product name, very large `₱` price formatted with `toLocaleString('en-PH', { minimumFractionDigits: 2 })`, the unit name and the barcode), a short pick-list when several candidates match a typed name, or the not-found state.
- A 10-second idle timer, reset on each keystroke and on each new result, that calls `clear()` on expiry.
- Render nothing from `product.stock`, `product.cost`, or supplier fields.

- [ ] **Step 4: Wire the page**

Replace `app/(app)/price-check/page.tsx` with a client component that wraps `<PriceCheckScreen />` in `<QueryClientProvider client={queryClient}>` using a module-level `QueryClient`, mirroring `app/(app)/pos/page.tsx`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:e2e -- price-check-kiosk`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the routing tests to confirm no regression**

Run: `npm run test:e2e -- price-check-routing`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no NEW errors versus the baseline.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/price-check/" tests/e2e/price-check-kiosk.spec.ts
git commit -m "feat: add the Price Inquiry kiosk screen"
```

---

### Task 5: Manual verification on the desktop target

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-price-inquiry-kiosk-design.md` (append a short "Verified" note)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create a kiosk user**

In User Management, create a user with user type `Price Inquiry`. Confirm the type appears in the dropdown and that `Price Inquiry (Kiosk)` is the only permission checked.

- [ ] **Step 2: Verify the login path**

Run `npm run electron-dev`, log in as that user.
Expected: lands on the kiosk screen, fullscreen, no sidebar, no header, no logout.

- [ ] **Step 3: Verify a real scan**

Scan a real product barcode with the attached scanner, with the window merely open and nothing clicked.
Expected: the price appears with no interaction, and matches what POS quotes for the same product at the default price level.

- [ ] **Step 4: Verify the pin**

With that session active, navigate to `/products` and `/dashboard` by URL.
Expected: redirected back to the kiosk both times.

- [ ] **Step 5: Record the result**

Append a short "Verified 2026-10-19" note to the spec recording what was exercised and the POS price agreement check, then commit.

```bash
git add docs/superpowers/specs/2026-10-19-price-inquiry-kiosk-design.md
git commit -m "docs: record kiosk manual verification"
```
