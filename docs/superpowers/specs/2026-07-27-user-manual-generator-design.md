# User Manual Generator — Design

**Date:** 2026-07-27
**Status:** Approved

## Problem

Verdix POS has 83 application screens and no end-user documentation suitable for
staff training or handoff to a customer. The existing `docs/USER_GUIDE.md` is a
390-line Markdown file with no screenshots — not usable as a printed or emailed
manual.

We need a Word (.docx) user manual, in English, with real screenshots, covering
both the cashier/POS workflow and the back-office/admin workflow.

## Goals

- Produce `docs/manual/VerdixPOS-User-Manual.docx` — a printable, shareable manual.
- Embed real screenshots captured from the running app, not mockups.
- Annotate key screens with numbered callouts matching numbered procedure steps.
- Make the manual a **rebuildable artifact**: when the UI changes, re-run one
  command rather than hand-editing a binary Word file.

## Non-Goals

- Not covering all 83 screens in full detail. The 23 report pages are covered as
  an indexed chapter, not one procedure each.
- No auto-publishing, no PDF export, no localization. English only.
- Not replacing `docs/USER_GUIDE.md` in this change (it may be retired later).

## Scope / Coverage

| Ch. | Chapter | Screens |
|-----|---------|---------|
| 1 | Getting Started — install, activation, login, UI tour | 4 |
| 2 | Cashier / POS — login, shift, checkout, payment, discount, hold, void/return, X/Z reading | 9 |
| 3 | Products — list, add, edit, families, pricing | 4 |
| 4 | Inventory — stock levels, adjustments, counts, repackaging, movement | 5 |
| 5 | Purchasing & Suppliers — PO, receiving, bad orders, supplier list/payments | 5 |
| 6 | Customers — list, payments, balances, loyalty | 4 |
| 7 | Approvals — board, workflow settings | 2 |
| 8 | Reports — hub screenshot + one-line index of all 23 reports | 3 |
| 9 | Settings & Users — POS setup, terminals, tax, users/roles | 5 |

Approximately 41 captured screens, producing an estimated 65–75 page document.

## Architecture

Four modules under `scripts/manual/`, each with one purpose and a file-based
interface, so that a UI change re-runs capture only and a wording change edits
content only.

```
scripts/manual/
  screens.ts      Screen registry: route, name, auth mode, callouts (data only)
  capture.ts      Stage 1+2: Playwright -> annotated PNG
  content.ts      Stage 3a: chapters, sections, numbered steps, figure refs
  build-docx.ts   Stage 3b: content + images -> .docx
```

### Stage 1 — Capture (`capture.ts`)

A standalone Playwright script (not a `.spec` file) run via `tsx`. It reuses the
existing e2e infrastructure:

- Targets the `verdix_test` database on port **3100**, the same isolated setup
  used by `playwright.config.ts`. No real customer data appears in the manual.
- Reuses `tests/e2e/helpers/auth.ts` — `seedSession()` to enter back-office
  pages directly without the login form.
- Reuses the proven POS sequence from `tests/e2e/pos-sale.spec.ts`: cashier
  login -> start shift -> add product by SKU.
- Fixed viewport 1440x900 for consistent figure sizing.
- Waits for `networkidle` plus a settle delay so charts finish animating.

Output: `docs/manual/images/<slug>.png`.

### Stage 2 — Annotation (in-browser)

Callouts are declared as data in `screens.ts` alongside each screen, referencing
a CSS selector or percentage coordinates:

```ts
callouts: [{ n: 1, selector: '[data-slot=sidebar]' }, { n: 2, x: 0.9, y: 0.1 }]
```

Before screenshotting, the script injects an absolutely-positioned overlay into
the page that draws numbered red circles at the resolved element positions. Doing
this in the browser avoids adding a native image-manipulation dependency.

### Stage 3 — Build (`content.ts` + `build-docx.ts`)

`content.ts` holds all prose as structured data (chapter -> section -> steps ->
figure reference). `build-docx.ts` walks that structure and emits the Word file
using the `docx` npm library: cover page, table of contents field, heading
styles, embedded figures with numbered captions, and tip/warning callout boxes.

### Why `docx` over the alternatives

Pandoc is not installed. Word COM automation is available but gives poor control
over image layout and is fragile to drive. The `docx` library gives full
programmatic control over headings, page breaks, image sizing, and captions, and
keeps the manual reproducible.

## Error Handling

Capture is the fragile stage — it requires MySQL and a dev server.

- A failing screen logs the screen name and the error, then **continues** to the
  remaining screens rather than aborting the run.
- The run prints a summary of missing captures at the end and exits non-zero if
  any failed, so the failure is never silent.
- `build-docx.ts` substitutes a visible `[SCREENSHOT MISSING: <name>]` placeholder
  box for any absent image, so a partial capture still produces a readable
  document instead of crashing.

## Testing

- `screens.ts` route list is validated against the real filesystem routes, so a
  renamed or deleted page fails fast rather than producing a blank screenshot.
- `build-docx.ts` is verified by asserting the output file exists, is non-trivial
  in size, and is a valid zip container (a .docx is a zip).
- Capture correctness is verified by inspecting generated PNGs, since screenshot
  fidelity cannot be meaningfully asserted programmatically.

## Deliverables

- `npm run manual:capture` — regenerate screenshots (needs DB + dev server)
- `npm run manual:build` — rebuild the .docx from existing images
- `npm run manual` — both
- `docs/manual/VerdixPOS-User-Manual.docx`
- `docs/manual/images/*.png` — **committed** to the repo, so the document
  rebuilds without a database.

## Decisions

- Screenshots are committed (estimated 15–25 MB) to keep the build reproducible
  offline. Accepted cost.
- Screenshot data comes from the seeded `verdix_test` fixtures, so figures show
  "Test Coffee 3-in-1" style products rather than live store data.
- Numbered callouts are applied to key procedure screens only, not to every
  figure, to limit maintenance cost.
