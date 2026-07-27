# User Manual Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a rebuildable Word user manual for Verdix POS — Playwright captures annotated screenshots from the seeded test DB, and a docx builder assembles them with structured prose into `docs/manual/VerdixPOS-User-Manual.docx`.

**Architecture:** Four modules under `scripts/manual/`. `screens.ts` is a pure data registry of routes and callouts. `capture.ts` drives Playwright against the `verdix_test` DB on port 3100, injecting a numbered-callout overlay before each screenshot. `content.ts` holds all manual prose as structured data. `build-docx.ts` walks that content and emits the .docx. Stages communicate through the filesystem, so a UI change re-runs capture only and a wording change touches content only.

**Tech Stack:** TypeScript, `tsx` runner, Playwright (already installed, `@playwright/test` ^1.60.0), `docx` npm library (^9.7.1), existing e2e helpers in `tests/e2e/`.

## Global Constraints

- Target the `verdix_test` database on port **3100** — never the dev DB on 3000. Set `DB_NAME=verdix_test`, `NEXT_PUBLIC_API_BASE_URL=http://localhost:3100/api`, `NEXT_DIST_DIR=.next-test`.
- Reuse `tests/e2e/helpers/auth.ts` (`seedSession`, `DEFAULT_ADMIN`) and `tests/e2e/fixtures/test-data.ts` (`TEST_USERS`, `TEST_PRODUCTS`, `TEST_PASSWORD`). Do not duplicate credentials.
- Fixed viewport **1440x900** for every capture, so figures size consistently in Word.
- Manual prose is **English**. UI labels quoted in steps must match the actual on-screen label exactly.
- A failing screen capture must log and continue, never abort the run. Exit non-zero if any screen failed.
- Screenshots are **committed** to `docs/manual/images/`.
- Scripts follow the existing `tsx scripts/<name>.ts` convention.
- Run `npm run typecheck` before every commit; it must pass.
- **Unit tests follow the existing house style**, seen in `tests/unit/product-type.test.ts`: bare top-level assertions using `node:assert/strict` that run on import, ending with a `console.log('<name>: all assertions passed')`. There is no test framework and no exported test functions. **Every new test file must also be registered with an `import './<name>.test';` line in `tests/unit/run.ts`, or it will never run.**

---

### Task 1: Screen registry with route validation

Creates the data registry every later task reads, and proves each declared route
maps to a real page file so a renamed page fails loudly instead of yielding a
blank screenshot.

**Files:**
- Create: `scripts/manual/screens.ts`
- Test: `tests/unit/manual-screens.test.ts`

**Interfaces:**
- Produces:
  - `type Callout = { n: number; selector?: string; x?: number; y?: number }`
  - `type AuthMode = 'admin' | 'pos' | 'none'`
  - `type Screen = { slug: string; route: string; title: string; auth: AuthMode; callouts?: Callout[]; waitFor?: string; setup?: string }`
  - `export const SCREENS: Screen[]`
  - `export function routeToPageFile(route: string): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/manual-screens.test.ts` in the house style — bare assertions, no framework:

```ts
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SCREENS, routeToPageFile } from '../../scripts/manual/screens';

// A screen pointing at a deleted or renamed page would silently produce a
// blank screenshot, so fail loudly here instead.
const root = process.cwd();
const missingPages = SCREENS
  .map((s) => ({ slug: s.slug, file: routeToPageFile(s.route) }))
  .filter(({ file }) => !existsSync(path.join(root, file)));
assert.deepEqual(missingPages, [], `screens point at non-existent pages: ${JSON.stringify(missingPages)}`);

const slugs = SCREENS.map((s) => s.slug);
assert.equal(new Set(slugs).size, slugs.length, 'duplicate screen slugs');

// Callouts must read 1..n in order, because the manual's numbered steps
// are keyed to these badge numbers.
for (const s of SCREENS) {
  if (!s.callouts?.length) continue;
  const ns = s.callouts.map((c) => c.n);
  assert.deepEqual(ns, ns.map((_, i) => i + 1), `callouts on ${s.slug} must be 1..n in order`);
}

for (const s of SCREENS) {
  for (const c of s.callouts ?? []) {
    const positioned = Boolean(c.selector) || (typeof c.x === 'number' && typeof c.y === 'number');
    assert.ok(positioned, `callout ${c.n} on ${s.slug} needs a selector or x/y`);
  }
}

console.log('manual-screens: all assertions passed');
```

Then register it in `tests/unit/run.ts` by appending:

```ts
import './manual-screens.test';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `../../scripts/manual/screens`.

- [ ] **Step 3: Write the registry**

`routeToPageFile` maps `/inventory/stock-counts` to `app/(app)/inventory/stock-counts/page.tsx`, with `/login`, `/signup`, `/activate` mapping to `app/<name>/page.tsx` (no route group).

```ts
export type Callout = { n: number; selector?: string; x?: number; y?: number };
export type AuthMode = 'admin' | 'pos' | 'none';

export type Screen = {
  /** Filename stem for the PNG, and the key content.ts references. */
  slug: string;
  route: string;
  /** Figure caption text. */
  title: string;
  auth: AuthMode;
  callouts?: Callout[];
  /** Optional selector to await before shooting, for slow-loading screens. */
  waitFor?: string;
  /** Named POS sequence to run before shooting (see capture.ts). */
  setup?: string;
};

const ROOT_ROUTES = new Set(['/login', '/signup', '/activate']);

export function routeToPageFile(route: string): string {
  const clean = route.split('?')[0].replace(/\/$/, '');
  if (ROOT_ROUTES.has(clean)) return `app${clean}/page.tsx`;
  return `app/(app)${clean}/page.tsx`;
}

export const SCREENS: Screen[] = [
  // Ch.1 Getting Started
  { slug: 'login', route: '/login', title: 'The login screen', auth: 'none',
    callouts: [{ n: 1, selector: 'input#username' }, { n: 2, selector: 'input#password' }] },
  { slug: 'activate', route: '/activate', title: 'License activation', auth: 'none' },
  { slug: 'dashboard', route: '/dashboard', title: 'The dashboard', auth: 'admin',
    callouts: [{ n: 1, selector: '[data-slot="sidebar"]' }] },

  // Ch.3 Products
  { slug: 'products-list', route: '/products', title: 'The product list', auth: 'admin' },

  // Ch.4 Inventory
  { slug: 'inventory-levels', route: '/inventory', title: 'Stock levels', auth: 'admin' },
  { slug: 'inventory-stock-counts', route: '/inventory/stock-counts', title: 'Stock counts', auth: 'admin' },
  { slug: 'inventory-repackaging', route: '/inventory/repackaging', title: 'Repackaging', auth: 'admin' },
  { slug: 'inventory-history', route: '/inventory/history', title: 'Adjustment history', auth: 'admin' },
  { slug: 'inventory-movement', route: '/inventory/movement', title: 'Stock movement', auth: 'admin' },

  // Ch.5 Purchasing & Suppliers
  { slug: 'purchases', route: '/purchases', title: 'Purchase orders', auth: 'admin' },
  { slug: 'purchases-bad-orders', route: '/purchases/bad-orders', title: 'Bad orders', auth: 'admin' },
  { slug: 'suppliers-list', route: '/suppliers/list', title: 'Supplier list', auth: 'admin' },
  { slug: 'suppliers-balance', route: '/suppliers/balance', title: 'Balance to supplier', auth: 'admin' },
  { slug: 'suppliers-payment', route: '/suppliers/payment', title: 'Supplier payments', auth: 'admin' },

  // Ch.6 Customers
  { slug: 'customer-list', route: '/customer', title: 'Customer list', auth: 'admin' },
  { slug: 'customer-payment', route: '/customer/payment', title: 'Customer payment', auth: 'admin' },
  { slug: 'customer-balances', route: '/customer/balances', title: 'Customer balances', auth: 'admin' },
  { slug: 'customer-loyalty', route: '/customer/loyalty', title: 'Loyalty points', auth: 'admin' },

  // Ch.7 Approvals
  { slug: 'approvals', route: '/approvals', title: 'Approvals board', auth: 'admin' },
  { slug: 'approvals-settings', route: '/approvals/settings', title: 'Workflow settings', auth: 'admin' },

  // Ch.8 Reports
  { slug: 'reports-hub', route: '/reports', title: 'The reports hub', auth: 'admin' },
  { slug: 'reports-sales-summary', route: '/reports/sales/summary', title: 'Sales summary report', auth: 'admin' },
  { slug: 'reports-low-stock', route: '/reports/low-stock', title: 'Low stock report', auth: 'admin' },

  // Ch.9 Settings & Users
  { slug: 'settings', route: '/settings', title: 'Settings', auth: 'admin' },
  { slug: 'settings-pos-setup', route: '/settings/pos-setup', title: 'POS setup', auth: 'admin' },
  { slug: 'settings-pos-terminals', route: '/settings/pos-terminals', title: 'POS terminals', auth: 'admin' },
  { slug: 'settings-tax-rates', route: '/settings/tax-rates', title: 'Tax rates', auth: 'admin' },
  { slug: 'user-management', route: '/user-management', title: 'User management', auth: 'admin' },

  // Ch.2 POS — driven by named setup sequences in capture.ts
  { slug: 'pos-login', route: '/pos', title: 'Cashier login', auth: 'none', setup: 'posLoginForm',
    callouts: [{ n: 1, selector: 'input#username' }, { n: 2, selector: 'input#password' }] },
  { slug: 'pos-start-shift', route: '/pos', title: 'Start shift dialog', auth: 'pos', setup: 'posStartShiftDialog' },
  { slug: 'pos-empty', route: '/pos', title: 'The POS screen', auth: 'pos', setup: 'posShiftStarted' },
  { slug: 'pos-cart', route: '/pos', title: 'Items in the cart', auth: 'pos', setup: 'posWithCart' },
  { slug: 'pos-x-reading', route: '/pos/x-reading', title: 'X-Reading', auth: 'pos', setup: 'posShiftStarted' },
  { slug: 'pos-z-reading', route: '/pos/z-reading', title: 'Z-Reading', auth: 'pos', setup: 'posShiftStarted' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS. If a route fails the existence check, correct the route in `SCREENS` — do not weaken the test.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add scripts/manual/screens.ts tests/unit/manual-screens.test.ts
git commit -m "feat(manual): screen registry with route validation"
```

---

### Task 2: Callout overlay renderer

The in-browser overlay that draws numbered red circles. Built and tested as a
pure function first so it is verifiable without launching a browser.

**Files:**
- Create: `scripts/manual/overlay.ts`
- Test: `tests/unit/manual-overlay.test.ts`

**Interfaces:**
- Consumes: `Callout` from `scripts/manual/screens.ts`
- Produces:
  - `export function calloutOverlayCss(): string`
  - `export function calloutMarkup(resolved: ResolvedCallout[]): string`
  - `export type ResolvedCallout = { n: number; x: number; y: number }` — x/y are CSS pixel positions in the viewport.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/manual-overlay.test.ts`:

```ts
import assert from 'node:assert/strict';
import { calloutMarkup, calloutOverlayCss } from '../../scripts/manual/overlay';

const two = calloutMarkup([{ n: 1, x: 10, y: 20 }, { n: 2, x: 30, y: 40 }]);
assert.equal((two.match(/manual-callout-badge/g) ?? []).length, 2, 'one badge per callout');
assert.ok(two.includes('>1<'), 'badge 1 rendered');
assert.ok(two.includes('>2<'), 'badge 2 rendered');

const one = calloutMarkup([{ n: 1, x: 10, y: 20 }]);
assert.ok(one.includes('left:10px'), 'badge positioned on x');
assert.ok(one.includes('top:20px'), 'badge positioned on y');

assert.equal(calloutMarkup([]), '', 'no callouts renders nothing');

// The overlay is injected into a page being screenshotted; an external fetch
// could stall or fail the capture.
const css = calloutOverlayCss();
assert.ok(css.includes('.manual-callout-badge'), 'badge class defined');
assert.ok(!css.includes('@import'), 'overlay CSS must not fetch external resources');

console.log('manual-overlay: all assertions passed');
```

Register it in `tests/unit/run.ts`:

```ts
import './manual-overlay.test';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `scripts/manual/overlay`.

- [ ] **Step 3: Implement the overlay**

```ts
export type ResolvedCallout = { n: number; x: number; y: number };

/** Self-contained styles for the callout badges. No external resources. */
export function calloutOverlayCss(): string {
  return `
.manual-callout-layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;}
.manual-callout-badge{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;
  border-radius:50%;background:#e11d48;color:#fff;border:2px solid #fff;
  font:700 15px/24px Arial,sans-serif;text-align:center;
  box-shadow:0 1px 4px rgba(0,0,0,.45);}
`.trim();
}

export function calloutMarkup(resolved: ResolvedCallout[]): string {
  if (resolved.length === 0) return '';
  const badges = resolved
    .map((c) => `<div class="manual-callout-badge" style="left:${Math.round(c.x)}px;top:${Math.round(c.y)}px">${c.n}</div>`)
    .join('');
  return `<div class="manual-callout-layer">${badges}</div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add scripts/manual/overlay.ts tests/unit/manual-overlay.test.ts
git commit -m "feat(manual): numbered callout overlay renderer"
```

---

### Task 3: Playwright capture script

Drives the browser and writes the PNGs. Verified by running it and inspecting
output, since screenshot fidelity is not meaningfully assertable.

**Files:**
- Create: `scripts/manual/capture.ts`
- Modify: `package.json` (add `manual:capture` script)

**Interfaces:**
- Consumes: `SCREENS`, `Screen`, `AuthMode` from `screens.ts`; `calloutMarkup`, `calloutOverlayCss`, `ResolvedCallout` from `overlay.ts`; `seedSession`, `DEFAULT_ADMIN` from `tests/e2e/helpers/auth.ts`; `TEST_USERS`, `TEST_PRODUCTS` from `tests/e2e/fixtures/test-data.ts`
- Produces: `docs/manual/images/<slug>.png`; exits non-zero if any screen failed.

- [ ] **Step 1: Write the capture script**

Key requirements, in order:

1. `chromium.launch()`, one context at `{ viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:3100' }`.
2. For `auth: 'admin'`, call `seedSession(page, DEFAULT_ADMIN)` before `goto`.
3. For POS screens, run the named `setup` sequence — mirror `tests/e2e/pos-sale.spec.ts` exactly:
   - `posLoginForm` — `goto('/pos')`, await the "Cashier login" heading, **do not** log in.
   - `posStartShiftDialog` — log in with `TEST_USERS.cashier`, await the "Start new shift" heading.
   - `posShiftStarted` — as above, then click "Start shift", await the barcode input.
   - `posWithCart` — as above, then fill the barcode input with `TEST_PRODUCTS[0].sku`, press Enter, await the product name. Use the retry-until-visible pattern from the spec, because the product list loads asynchronously.
4. Await `networkidle`, then `waitForTimeout(700)` so charts finish animating. If `screen.waitFor` is set, await that selector too.
5. Resolve callouts: for a `selector`, use `boundingBox()` and place the badge at the box's top-left inset by ~12px; for `x`/`y`, multiply by viewport dimensions. Skip a callout whose selector does not resolve and warn — do not fail the screen.
6. Inject the overlay via `page.addStyleTag({ content: calloutOverlayCss() })` and `page.evaluate` inserting `calloutMarkup(resolved)` into `document.body`.
7. `page.screenshot({ path: 'docs/manual/images/<slug>.png' })`.
8. Wrap each screen in try/catch: log `✗ <slug>: <message>`, push to a `failed[]` array, continue.
9. At the end print a summary; `process.exitCode = 1` if `failed.length > 0`.

Write real code — no TODOs. Reuse the helper imports rather than redefining credentials.

- [ ] **Step 2: Add the npm script**

```json
"manual:capture": "tsx scripts/manual/capture.ts"
```

- [ ] **Step 3: Start the test server and prepare the DB**

```bash
npm run test:e2e:db
npx cross-env DB_NAME=verdix_test NEXT_PUBLIC_API_BASE_URL=http://localhost:3100/api NEXT_DIST_DIR=.next-test next dev -p 3100
```

Leave this running in a second terminal. On Windows PowerShell without `cross-env`, set the variables with `$env:DB_NAME='verdix_test'` etc. before `next dev -p 3100`.

- [ ] **Step 4: Run the capture and inspect the output**

Run: `npm run manual:capture`
Expected: `docs/manual/images/` fills with PNGs and the run reports 0 failures.

Then **actually open several PNGs** — at minimum `dashboard.png`, `pos-cart.png`, and `login.png` — and confirm: the page is fully rendered (not a loading spinner or empty table), and callout badges sit on the intended controls. Fix selectors and waits until they do. This visual check is the real test for this task.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add scripts/manual/capture.ts package.json docs/manual/images
git commit -m "feat(manual): Playwright screenshot capture with callouts"
```

---

### Task 4: Manual content

All manual prose, as data. No Word or Playwright concerns here — this task is
pure text and can be reviewed for accuracy on its own.

**Files:**
- Create: `scripts/manual/content.ts`
- Test: `tests/unit/manual-content.test.ts`

**Interfaces:**
- Consumes: `SCREENS` from `screens.ts` (to validate figure references)
- Produces:
  - `type Block = { kind: 'para'; text: string } | { kind: 'steps'; items: string[] } | { kind: 'figure'; slug: string } | { kind: 'note'; variant: 'tip' | 'warning'; text: string } | { kind: 'table'; headers: string[]; rows: string[][] }`
  - `type Section = { heading: string; blocks: Block[] }`
  - `type Chapter = { number: number; title: string; intro: string; sections: Section[] }`
  - `export const MANUAL_TITLE: string`, `export const MANUAL_SUBTITLE: string`
  - `export const CHAPTERS: Chapter[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/manual-content.test.ts`:

```ts
import assert from 'node:assert/strict';
import { CHAPTERS } from '../../scripts/manual/content';
import { SCREENS } from '../../scripts/manual/screens';

const allBlocks = CHAPTERS.flatMap((c) => c.sections.flatMap((s) => s.blocks));

// slug is the join key between SCREENS, the PNG filenames, and figure blocks.
// A typo here silently yields a [SCREENSHOT MISSING] box in the built manual.
const knownSlugs = new Set(SCREENS.map((s) => s.slug));
const badRefs = allBlocks
  .filter((b) => b.kind === 'figure')
  .map((b) => (b as { kind: 'figure'; slug: string }).slug)
  .filter((slug) => !knownSlugs.has(slug));
assert.deepEqual(badRefs, [], `content references unknown screen slugs: ${badRefs.join(', ')}`);

assert.deepEqual(CHAPTERS.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'chapters 1-9');

for (const c of CHAPTERS) {
  assert.ok(c.sections.length > 0, `chapter ${c.number} has no sections`);
  for (const s of c.sections) {
    assert.ok(s.blocks.length > 0, `section "${s.heading}" is empty`);
  }
}

const serialized = JSON.stringify(CHAPTERS);
for (const marker of ['TODO', 'TBD', 'Lorem ipsum', 'FIXME']) {
  assert.ok(!serialized.includes(marker), `content still contains "${marker}"`);
}

// Chapter 8 indexes the report pages that get no procedure of their own.
const ch8 = CHAPTERS.find((c) => c.number === 8);
assert.ok(ch8, 'chapter 8 exists');
const reportRows = ch8.sections
  .flatMap((s) => s.blocks)
  .filter((b) => b.kind === 'table')
  .reduce((n, t) => n + (t as { kind: 'table'; rows: string[][] }).rows.length, 0);
assert.ok(reportRows >= 23, `report index lists ${reportRows} reports, expected at least 23`);

console.log('manual-content: all assertions passed');
```

Register it in `tests/unit/run.ts`:

```ts
import './manual-content.test';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `scripts/manual/content`.

- [ ] **Step 3: Write the content**

Nine chapters per the spec table. Rules:

- Steps are imperative and reference **exact on-screen labels** in quotes. Read the relevant `page.tsx` to confirm each label before writing it — a manual that names a button that does not exist is worse than no manual.
- Every procedure section places its `figure` block immediately after the `steps` block it illustrates.
- For screens with callouts in `screens.ts`, the step numbering must match the callout numbering.
- Chapter 8 contains a `table` block listing all 23 report routes with a one-line purpose each. Enumerate them from `app/(app)/reports/**` and the `salesNavItems` list in `app/(app)/layout-nav-config.ts`.
- Use `note` blocks for the legally significant points, at minimum: BIR SI numbers are sequential and must never be gapped, and a Z-Reading closes the day and cannot be re-run.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add scripts/manual/content.ts tests/unit/manual-content.test.ts
git commit -m "feat(manual): manual content as structured data"
```

---

### Task 5: Word document builder

Turns content plus images into the .docx.

**Files:**
- Create: `scripts/manual/build-docx.ts`
- Test: `tests/unit/manual-build.test.ts`
- Modify: `package.json` (add `docx` dependency and `manual:build`, `manual` scripts)

**Interfaces:**
- Consumes: `CHAPTERS`, `MANUAL_TITLE`, `MANUAL_SUBTITLE` from `content.ts`; `SCREENS` from `screens.ts`
- Produces: `export async function buildManual(outPath: string): Promise<{ figures: number; missing: string[] }>`; writes `docs/manual/VerdixPOS-User-Manual.docx`

- [ ] **Step 1: Install the dependency**

```bash
npm install --save-dev docx@^9.7.1
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/manual-build.test.ts`. `buildManual` is async and every
existing unit test is synchronous, so there is no house precedent — wrap the
body in a top-level IIFE with an explicit rejection handler, so a failed
assertion still exits non-zero rather than becoming an unhandled rejection:

```ts
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildManual } from '../../scripts/manual/build-docx';

const OUT = path.join(process.cwd(), 'tests', 'unit', '.tmp-manual.docx');

void (async () => {
  rmSync(OUT, { force: true });
  const result = await buildManual(OUT);

  assert.ok(existsSync(OUT), 'no .docx was written');

  const buf = readFileSync(OUT);
  // A .docx is a zip container; it must start with the PK local-file header.
  assert.equal(buf.subarray(0, 2).toString('ascii'), 'PK', 'output is not a zip container');
  assert.ok(buf.length > 20_000, `document is implausibly small (${buf.length} bytes)`);

  // A missing PNG must degrade to a placeholder, never throw.
  assert.ok(Array.isArray(result.missing), 'missing[] not reported');
  assert.ok(result.figures > 0, 'no figures were embedded');

  rmSync(OUT, { force: true });
  console.log('manual-build: all assertions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Register it in `tests/unit/run.ts`:

```ts
import './manual-build.test';
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `scripts/manual/build-docx`.

- [ ] **Step 4: Implement the builder**

Requirements:

1. Cover page — `MANUAL_TITLE`, `MANUAL_SUBTITLE`, generated date, then a page break.
2. `TableOfContents("1-3")` followed by a page break. Word prompts to update fields on open; note this in the README.
3. Each chapter starts on a new page: `HeadingLevel.HEADING_1` for the chapter, `HEADING_2` for sections.
4. `steps` blocks render as a numbered list (`numbering` reference), `para` as body text.
5. `figure` blocks: read `docs/manual/images/<slug>.png`, embed via `ImageRun` scaled to a 600px content width preserving aspect ratio (source is 1440x900, so 600x375), followed by an italic centered caption `Figure N: <screen title>` using the title from `SCREENS`. Increment N across the whole document.
6. If the PNG is absent: push the slug to `missing[]` and emit a visibly shaded paragraph reading `[SCREENSHOT MISSING: <slug>]` instead. **Never throw.**
7. `note` blocks render as a single-cell shaded table — amber for `tip`, red-tinted for `warning`.
8. `table` blocks render as a bordered Word table with a bold header row.
9. When run directly, write to `docs/manual/VerdixPOS-User-Manual.docx` and log the figure count and any missing slugs.

- [ ] **Step 5: Add the npm scripts**

```json
"manual:build": "tsx scripts/manual/build-docx.ts",
"manual": "npm run manual:capture && npm run manual:build"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 7: Build the real manual and open it**

Run: `npm run manual:build`
Then open `docs/manual/VerdixPOS-User-Manual.docx` in Word and confirm: the TOC populates after accepting the field-update prompt, images are not distorted, captions are sequential, and no `[SCREENSHOT MISSING]` boxes remain. Fix and rebuild until clean.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck
git add scripts/manual/build-docx.ts tests/unit/manual-build.test.ts package.json package-lock.json docs/manual/VerdixPOS-User-Manual.docx
git commit -m "feat(manual): Word document builder"
```

---

### Task 6: Regeneration README

Without this, the next person cannot rebuild the manual — the capture stage has
non-obvious prerequisites.

**Files:**
- Create: `docs/manual/README.md`

- [ ] **Step 1: Write the README**

Cover: what the three npm scripts do; the prerequisite that MySQL must be running and a dev server must be up on port 3100 with `DB_NAME=verdix_test`; that `manual:build` alone works offline from committed PNGs; that Word prompts to update the TOC on first open and this is expected; and how to add a new screen (add to `SCREENS`, add a `figure` block in `CHAPTERS`, re-run `npm run manual`).

- [ ] **Step 2: Verify the documented commands actually work**

Run `npm run manual:build` exactly as the README describes it and confirm it succeeds.

- [ ] **Step 3: Commit**

```bash
git add docs/manual/README.md
git commit -m "docs(manual): how to regenerate the user manual"
```

---

## Self-Review

**Spec coverage:** Registry+validation (T1) covers the testing requirement; capture and annotation (T2, T3) cover stages 1–2; content (T4) covers chapter scope including the 23-report index; builder (T5) covers stage 3 and the missing-image fallback; README (T6) covers the deliverable commands. Error handling — continue-on-failure, non-zero exit, missing-image placeholder — is specified in T3 step 1.8 and T5 step 4.6.

**Placeholder scan:** No TBDs. Task 3 and Task 4 describe requirements rather than full literal source because their content is dictated by live UI labels that must be read from the codebase at implementation time; both include explicit verification steps that gate on real output.

**Type consistency:** `Screen`/`Callout`/`AuthMode` defined in T1 and consumed unchanged in T3. `ResolvedCallout` defined in T2, produced in T3. `Block`/`Section`/`Chapter` defined in T4, consumed in T5. `slug` is the single join key between `SCREENS`, the PNG filenames, and `figure` blocks — validated by tests in both T1 and T4.

**Test-runner conformance:** `tests/unit/run.ts` has no framework — it imports each test file for its side effects, and files assert at the top level. An earlier draft of this plan used exported `testX()` functions, which would have been imported and never invoked, producing four silently-passing test files. All four test tasks now use bare top-level assertions and each includes the required `run.ts` registration line. Task 5's test is the only async one and uses an IIFE with an explicit non-zero exit on rejection.
