# Reports: Search Field + Export to Excel (all report pages)

## Problem

Under `app/(app)/reports/**` there are ~24 report pages. Most already have
"Export to PDF" (via `lib/report-print.ts`'s `exportReportPdf()`), and 14 of
them already have a client-side search box. There is no Excel export
anywhere except a one-off, page-specific implementation in
`sales/bir-summary/page.tsx`. Ten pages have no search field at all.

Goal: every report page gets a search field (if missing) and an
"Export to Excel" button (everywhere), consistent with the existing PDF
export and search conventions already used across the reports section.

## Non-goals

- Server-side search (existing pattern is client-side `.filter()` over
  already-fetched rows; stays that way).
- Real `.xlsx` binary format — reuse the existing HTML-table-as-`.xls`
  technique already proven in `bir-summary`, no new npm dependency.
- A combined "Export ▾" dropdown — PDF and Excel stay separate,
  same-styled buttons side by side.
- Rewriting `sales/bir-summary`'s existing bespoke Excel export. It
  already works; migrating it to the new shared helper is optional
  follow-up, not required here.
- Introducing a shared `<DataTable>`/table component. Out of scope — each
  page keeps its own hand-rolled `<Table>`.

## Design

### 1. Shared Excel exporter — `lib/report-print.ts`

Add `exportReportExcel<T>()` alongside the existing `exportReportPdf<T>()`,
reusing the same column-config shape already defined per-page for PDF
export (`header` + `cell(row, index)` + optional `align`/`emphasize`).
Pages that already build a `PdfReportColumn<T>[]` array pass the same
`header`/`cell`/`align` fields (the PDF-only `width` field is simply
unused by the Excel exporter — no page needs to define a second column
array).

```ts
export interface ExcelReportColumn<T> {
  header: string;
  align?: 'left' | 'right' | 'center';
  cell: (row: T, index: number) => string | number;
}

export interface ExcelReportOptions<T> {
  title: string;          // sheet name + used in a title row
  columns: ExcelReportColumn<T>[];
  rows: T[];
  totals?: (string | number | null)[];  // optional totals row, 1:1 with columns
  fileName: string;       // e.g. "Sales_By_Product_20260810.xls"
}

export function exportReportExcel<T>(opts: ExcelReportOptions<T>): boolean
```

Behavior mirrors `exportReportPdf`: returns `false` (does nothing) when
`rows.length === 0` so callers can toast "No Data" exactly like they
already do for PDF. Implementation follows the pattern already in
`sales/bir-summary/page.tsx` (`exportExcel` around line 332): build an
HTML `<table>` string with the MSO Excel namespace `<head>` block, wrap in
a `Blob` of type `application/vnd.ms-excel;charset=utf-8;`, trigger a
download via a temporary `<a>` link. Escaping reuses the existing
`escapeReportHtml()` helper already exported from this file.

### 2. Shared search input component

New `components/reports/ReportSearchInput.tsx`: a small controlled input
(search icon, placeholder, clear "×" button when non-empty), wrapping the
`value`/`onChange` pair pages already manage via `useState<string>`. Not a
new filtering mechanism — just extracts the repeated JSX/markup that the
14 existing pages already hand-roll, so the 10 pages gaining search reuse
the same look instead of re-inventing it, and existing pages can
optionally adopt it for consistency (not required if it'd churn a working
page unnecessarily — new pages must use it, existing pages may keep their
current input if functionally identical).

Filtering logic itself stays inline per page (`records.filter(r => ...)`
over the fields relevant to that page's table), matching the existing
`sales/by-product` convention — no generic/abstracted matcher, since each
page's row shape and searchable fields differ.

### 3. Per-page rollout

For each of the ~24 pages under `reports/`:

- **If no search box exists**: add `const [searchTerm, setSearchTerm] =
  useState('')`, a `<ReportSearchInput>` in the filter toolbar, and a
  `filteredRecords = records.filter(...)` matching against the 2-4 most
  relevant string fields shown in that page's table (e.g. product
  name/barcode/category for inventory-shaped pages; reason/reference for
  adjustments). Wire the existing pagination to `filteredRecords` instead
  of `records` (same as pages that already have this).
- **Every page**: add an "Export to Excel" button next to the existing
  "Export to PDF" button (same variant/style, green outline convention
  already used), calling `exportReportExcel()` with the same
  `title`/`columns`/`rows`/`totals`/`fileName` values already assembled
  for that page's `exportToPDF()` (column array reused, `width` field
  simply omitted/ignored). File name suffix `.xls` in place of `.pdf`.
  Toast on success/failure mirrors the existing PDF toast pattern
  (`'Excel Exported'` / `'No Data'`).
- **Pages with no PDF export today** (adjustments, cost-vs-retail,
  expiring-soon, inventory, movements, velocity — currently "Print only"):
  gain both search and Excel export as net-new; no PDF column config
  exists yet to reuse, so a `columns` array is authored fresh for the
  Excel call only (PDF stays out of scope — not requested).
- **Multi-section pages** (`expiring-soon`'s expired/upcoming tables,
  `velocity`'s fast/slow/none tabs, `sales/split-payments`'s
  expandable/nested rows): Excel export covers only the currently active
  tab/section, same scope as how PDF export already behaves on these
  pages today (mirrors existing per-tab behavior, e.g. `bir-summary`).
  `split-payments`' nested per-row tables (line items, payment splits)
  are not flattened into the Excel export — only the visible top-level
  columns, matching PDF.

### Error handling

No new error paths. `exportReportExcel` returns `false` on empty rows
(existing "No Data" toast pattern); otherwise the Blob download either
succeeds or the browser handles the failure natively (same as the
existing PDF/bir-summary export — no try/catch changes needed beyond
what pages already have around their `exportToPDF` calls).

### Testing

Manual verification per page (no existing automated test coverage for
report pages' export/search UI): type into the new search box and confirm
row filtering; click "Export to Excel" and confirm a `.xls` file
downloads and opens with correct headers/rows/totals matching the
on-screen table.
