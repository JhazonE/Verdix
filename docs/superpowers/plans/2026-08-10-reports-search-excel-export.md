# Reports: Search Field + Export to Excel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a search field (where missing) and an "Export to Excel" button (everywhere) to all ~24 report pages under `app/(app)/reports/**`.

**Architecture:** Two shared, reusable pieces land first: `exportReportExcel<T>()` in `lib/report-print.ts` (sibling to the existing `exportReportPdf<T>()`, reusing the same column-config shape, generating an HTML-table-as-`.xls` download exactly like the working implementation already in `sales/bir-summary/page.tsx`) and `<ReportSearchInput>` in `components/reports/ReportSearchInput.tsx` (extracts the search-box markup already repeated across 14 pages). Every report page then gets a small, mechanical edit: add `searchTerm` state + filter (if missing) and an Excel button next to the PDF/Print button (reusing that page's existing column config).

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, existing `lib/report-print.ts` helpers, `lucide-react` icons, shadcn `Table`/`Button`/`Input` components. No new npm dependencies.

## Global Constraints

- No new npm dependency — Excel export reuses the existing HTML-table-as-`.xls` Blob-download technique (see `sales/bir-summary/page.tsx:332-379`).
- Search is client-side only (`useState` + `.filter()` over already-fetched rows) — no server/API changes.
- **Excel export always exports the current filtered/searched set** (`filteredRecords`), not the full unfiltered `records` — consistent across all pages, matches "export what's on screen."
- Multi-section pages (`expiring-soon`, `velocity`, `sales/split-payments`) export only the active tab/section/nested-flattened view, mirroring their existing PDF/print export scope.
- `sales/bir-summary` already has a working, page-specific Excel export — leave it untouched; not in scope.
- Button style convention: Excel button sits immediately after the existing "Export to PDF"/"Export PDF" button (or, for `printReportTable`-only pages, after "Print Report"), same `variant="outline"` sizing, `<FileSpreadsheet className="mr-2 h-4 w-4" />` icon from `lucide-react`, green outline classes (`border-green-600 text-green-600 hover:bg-green-50`) unless the page already uses green for its PDF button — then use `border-emerald-700 text-emerald-700 hover:bg-emerald-50` to stay visually distinct from the neighboring button.
- Toast pattern on Excel export mirrors existing PDF toasts: success → `{ title: 'Excel Exported', description: `Report saved as ${fileName}` }`; empty rows → `{ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' }`.
- File naming: same base name as the page's PDF export with `.xls` extension instead of `.pdf` (e.g. `Sales_By_Product_20260810_20260810.xls`). Pages with no existing PDF export get a new descriptive `PascalCase_With_Underscores_YYYYMMDD.xls` name following the same convention.

---

## Task 1: Shared Excel exporter — `lib/report-print.ts`

**Files:**
- Modify: `lib/report-print.ts` (append after `exportReportPdf`, i.e. after line 319)
- Test: manual (no existing test coverage for `report-print.ts`; verified by downloading and opening the file in Excel/LibreOffice per page in later tasks)

**Interfaces:**
- Consumes: `escapeReportHtml()` already exported from this file (line 5).
- Produces: `ExcelReportColumn<T>`, `ExcelReportOptions<T>`, `exportReportExcel<T>(opts): boolean` — every later per-page task imports and calls this.

- [ ] **Step 1: Add the Excel column/options types and the exporter function**

Append to `d:\VERDIX_POS\Verdix_POS\lib\report-print.ts`, after the closing brace of `exportReportPdf` (line 319):

```ts
// ---------------------------------------------------------------------------
// Shared Excel export — generates an HTML-table-based .xls download (same
// technique proven in sales/bir-summary/page.tsx), no new dependency.
// ---------------------------------------------------------------------------

export interface ExcelReportColumn<T> {
  header: string;
  align?: ReportAlign;
  /** Return the already-formatted cell text/number (use the same formatters as the on-screen table). */
  cell: (row: T, index: number) => string | number;
}

export interface ExcelReportOptions<T> {
  /** Used as the sheet name and the title row above the table. */
  title: string;
  /** Optional line shown under the title (e.g. a date range). */
  subtitle?: string;
  columns: ExcelReportColumn<T>[];
  rows: T[];
  /** Totals row, aligned 1:1 to `columns`. Use null for cells with no total. */
  totals?: (string | number | null)[];
  fileName: string;
}

/**
 * Downloads `rows` as an .xls file (HTML table wrapped in the Excel MSO
 * namespace so it opens natively in Excel/LibreOffice/Sheets).
 * Returns false if there are no rows to export (caller can toast "No Data").
 */
export function exportReportExcel<T>(opts: ExcelReportOptions<T>): boolean {
  const { title, subtitle, columns, rows, totals, fileName } = opts;
  if (rows.length === 0) return false;

  const colCount = columns.length;
  const isNum = (v: unknown) => typeof v === 'number';

  const headCells = columns
    .map(
      (c) =>
        `<th style="background:#2563eb;color:#ffffff;border:1px solid #1e3a8a;padding:4px;font-weight:bold;text-align:${
          c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left'
        }">${escapeReportHtml(c.header)}</th>`
    )
    .join('');

  const bodyRows = rows
    .map((row, rowIndex) => {
      const cells = columns
        .map((c) => {
          const value = c.cell(row, rowIndex);
          const align = c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left';
          const numFmt = isNum(value) ? 'mso-number-format:\\#\\,\\#\\#0\\.00;' : '';
          return `<td style="border:1px solid #cccccc;padding:3px;text-align:${align};${numFmt}">${escapeReportHtml(value)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const totalsRow = totals
    ? `<tr>${columns
        .map((c, i) => {
          const val = totals[i];
          const align = c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left';
          return `<td style="border:1px solid #cccccc;padding:3px;font-weight:bold;background:#f1f5f9;text-align:${align}">${
            val == null ? '' : escapeReportHtml(val)
          }</td>`;
        })
        .join('')}</tr>`
    : '';

  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${escapeReportHtml(
      title.slice(0, 31)
    )}</x:Name>` +
    `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>` +
    `<body><table border="0" cellspacing="0">` +
    `<tr><td colspan="${colCount}" style="font-size:15px;font-weight:bold">${escapeReportHtml(title)}</td></tr>` +
    (subtitle ? `<tr><td colspan="${colCount}">${escapeReportHtml(subtitle)}</td></tr>` : '') +
    `<tr><td colspan="${colCount}"></td></tr>` +
    `<tr>${headCells}</tr>` +
    bodyRows +
    totalsRow +
    `</table></body></html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  return true;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors introduced by `lib/report-print.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/report-print.ts
git commit -m "feat(reports): add shared exportReportExcel helper"
```

---

## Task 2: Shared search input — `components/reports/ReportSearchInput.tsx`

**Files:**
- Create: `components/reports/ReportSearchInput.tsx`
- Test: manual (visually verified once wired into a page in a later task)

**Interfaces:**
- Consumes: `Input` from `@/components/ui/input`, `Search`/`X` icons from `lucide-react`, `cn` from `@/lib/utils`.
- Produces: `<ReportSearchInput value, onChange, placeholder?, className? />` — every page task that adds a new search box uses this component instead of hand-rolling the `relative`/`Search`-icon/`Input` markup.

- [ ] **Step 1: Write the component**

Create `d:\VERDIX_POS\Verdix_POS\components\reports\ReportSearchInput.tsx`:

```tsx
'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ReportSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function ReportSearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
}: ReportSearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9 pr-9 w-[250px]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/reports/ReportSearchInput.tsx
git commit -m "feat(reports): add shared ReportSearchInput component"
```

---

## Task 3: `sales/by-product`, `sales/profit-margin`, `sales/top-sales`, `sales/top-volume` — Excel export (search already present)

These four pages share the identical `ProductSale` interface, identical `filteredRecords` predicate, and near-identical PDF column arrays (top-sales/top-volume add a Rank column). Search boxes already exist on all four — this task only adds Excel export.

**Files:**
- Modify: `app/(app)/reports/sales/by-product/page.tsx`
- Modify: `app/(app)/reports/sales/profit-margin/page.tsx`
- Modify: `app/(app)/reports/sales/top-sales/page.tsx`
- Modify: `app/(app)/reports/sales/top-volume/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1); existing `filteredRecords`, `totals`, `formatCurrency`, `fromDate`/`toDate` already defined in each file.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: `sales/by-product/page.tsx` — import and add `exportToExcel`**

In `app/(app)/reports/sales/by-product/page.tsx`, change the import line (currently line 36):

```ts
import { exportReportPdf } from '@/lib/report-print';
```

to:

```ts
import { exportReportPdf, exportReportExcel } from '@/lib/report-print';
```

Then add `FileSpreadsheet` to the lucide-react import (line 21):

```ts
import { CalendarIcon, FileDown, FileSpreadsheet, Package2, TrendingUp, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
```

Add a new `exportToExcel` function immediately after the existing `exportToPDF` function (after its closing `};` around line 172):

```ts
  const exportToExcel = () => {
    const fileName = `Sales_By_Product_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<ProductSale>({
      title: 'Sales by Product Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Product', cell: (r) => r.product.name || 'N/A' },
        { header: 'Barcode', cell: (r) => r.product.barcode || '-' },
        { header: 'Category', cell: (r) => r.product.category || '-' },
        { header: 'Brand', cell: (r) => r.product.brand || '-' },
        { header: 'Units Sold', align: 'right', cell: (r) => r.unitsSold },
        { header: 'UOM', cell: (r) => r.product.unitOfMeasure || '-' },
        { header: 'Revenue', align: 'right', cell: (r) => r.totalRevenue },
        { header: 'Cost', align: 'right', cell: (r) => r.totalCost },
        { header: 'Profit', align: 'right', cell: (r) => r.totalProfit },
        { header: 'Margin %', align: 'right', cell: (r) => (r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100) : 0).toFixed(1) + '%' },
        { header: '# Sales', align: 'right', cell: (r) => r.numberOfSales },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, totals.unitsSold, null, totals.revenue.toFixed(2), totals.cost.toFixed(2), totals.profit.toFixed(2), null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Add the button immediately after the existing "Export to PDF" `Button` (after line 266, i.e. right after its closing `</Button>`):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 2: `sales/profit-margin/page.tsx` — same pattern**

Apply the identical change to `app/(app)/reports/sales/profit-margin/page.tsx` (its import line, lucide-react import, `exportToPDF` location, and button are at the same line numbers as by-product: import at line 36, icons at line 21 — verify exact line before editing since profit-margin may have a slightly different icon import list — button after line 266). Use `title: 'Profit Margin Report'` and `fileName` prefix `Profit_Margin_Report_` matching its existing PDF `fileName` pattern:

```ts
  const exportToExcel = () => {
    const fileName = `Profit_Margin_Report_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<ProductSale>({
      title: 'Profit Margin Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Product', cell: (r) => r.product.name || 'N/A' },
        { header: 'Barcode', cell: (r) => r.product.barcode || '-' },
        { header: 'Category', cell: (r) => r.product.category || '-' },
        { header: 'Brand', cell: (r) => r.product.brand || '-' },
        { header: 'Units Sold', align: 'right', cell: (r) => r.unitsSold },
        { header: 'UOM', cell: (r) => r.product.unitOfMeasure || '-' },
        { header: 'Revenue', align: 'right', cell: (r) => r.totalRevenue },
        { header: 'Cost', align: 'right', cell: (r) => r.totalCost },
        { header: 'Profit', align: 'right', cell: (r) => r.totalProfit },
        { header: 'Margin %', align: 'right', cell: (r) => (r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100) : 0).toFixed(1) + '%' },
        { header: '# Sales', align: 'right', cell: (r) => r.numberOfSales },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, totals.unitsSold, null, totals.revenue.toFixed(2), totals.cost.toFixed(2), totals.profit.toFixed(2), null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Same button JSX as Step 1 (adjust nothing — it's the same `exportToExcel`/`records`/`isLoading` names).

- [ ] **Step 3: `sales/top-sales/page.tsx` — same pattern, with Rank column**

Apply to `app/(app)/reports/sales/top-sales/page.tsx` (import at line 36, icons at line 21, `exportToPDF` block near lines 138-167, button near lines 259-267). Rank in Excel uses the plain row index (matches the PDF's `(i+1)` — Excel exports the full filtered list in order, not a paginated slice):

```ts
  const exportToExcel = () => {
    const fileName = `Top_Items_Sales_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<ProductSale>({
      title: 'Top Items by Sales Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Rank', align: 'right', cell: (_r, i) => i + 1 },
        { header: 'Product', cell: (r) => r.product.name || 'N/A' },
        { header: 'Barcode', cell: (r) => r.product.barcode || '-' },
        { header: 'Category', cell: (r) => r.product.category || '-' },
        { header: 'Brand', cell: (r) => r.product.brand || '-' },
        { header: 'Units Sold', align: 'right', cell: (r) => r.unitsSold },
        { header: 'UOM', cell: (r) => r.product.unitOfMeasure || '-' },
        { header: 'Revenue', align: 'right', cell: (r) => r.totalRevenue },
        { header: 'Cost', align: 'right', cell: (r) => r.totalCost },
        { header: 'Profit', align: 'right', cell: (r) => r.totalProfit },
        { header: 'Margin %', align: 'right', cell: (r) => (r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100) : 0).toFixed(1) + '%' },
        { header: '# Sales', align: 'right', cell: (r) => r.numberOfSales },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, null, totals.unitsSold, null, totals.revenue.toFixed(2), totals.cost.toFixed(2), totals.profit.toFixed(2), null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Same button JSX as Step 1.

- [ ] **Step 4: `sales/top-volume/page.tsx` — same pattern as Step 3**

Apply the identical change to `app/(app)/reports/sales/top-volume/page.tsx`, only changing `title: 'Top Items by Volume Report'` and `fileName` prefix `Top_Items_Volume_`:

```ts
  const exportToExcel = () => {
    const fileName = `Top_Items_Volume_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<ProductSale>({
      title: 'Top Items by Volume Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Rank', align: 'right', cell: (_r, i) => i + 1 },
        { header: 'Product', cell: (r) => r.product.name || 'N/A' },
        { header: 'Barcode', cell: (r) => r.product.barcode || '-' },
        { header: 'Category', cell: (r) => r.product.category || '-' },
        { header: 'Brand', cell: (r) => r.product.brand || '-' },
        { header: 'Units Sold', align: 'right', cell: (r) => r.unitsSold },
        { header: 'UOM', cell: (r) => r.product.unitOfMeasure || '-' },
        { header: 'Revenue', align: 'right', cell: (r) => r.totalRevenue },
        { header: 'Cost', align: 'right', cell: (r) => r.totalCost },
        { header: 'Profit', align: 'right', cell: (r) => r.totalProfit },
        { header: 'Margin %', align: 'right', cell: (r) => (r.totalRevenue > 0 ? ((r.totalProfit / r.totalRevenue) * 100) : 0).toFixed(1) + '%' },
        { header: '# Sales', align: 'right', cell: (r) => r.numberOfSales },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, null, totals.unitsSold, null, totals.revenue.toFixed(2), totals.cost.toFixed(2), totals.profit.toFixed(2), null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Same button JSX as Step 1.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors in any of the four files.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, visit `/reports/sales/by-product`, `/reports/sales/profit-margin`, `/reports/sales/top-sales`, `/reports/sales/top-volume`. On each: fetch a report with data, type a search term, click "Export to Excel", confirm a `.xls` file downloads and opens with headers/rows matching the filtered on-screen table (and Rank column present/correct on top-sales/top-volume).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/reports/sales/by-product/page.tsx" "app/(app)/reports/sales/profit-margin/page.tsx" "app/(app)/reports/sales/top-sales/page.tsx" "app/(app)/reports/sales/top-volume/page.tsx"
git commit -m "feat(reports): add Excel export to sales product/margin/top pages"
```

---

## Task 4: `sales/by-customer`, `purchases/by-product`, `purchases/by-supplier`, `purchases/summary` — Excel export (search already present)

**Files:**
- Modify: `app/(app)/reports/sales/by-customer/page.tsx`
- Modify: `app/(app)/reports/purchases/by-product/page.tsx`
- Modify: `app/(app)/reports/purchases/by-supplier/page.tsx`
- Modify: `app/(app)/reports/purchases/summary/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: `sales/by-customer/page.tsx`**

Update the `@/lib/report-print` import to include `exportReportExcel`, add `FileSpreadsheet` to the lucide-react icon import, add this function after `exportToPDF` (after its close near line 184):

```ts
  const exportToExcel = () => {
    const fileName = `Sales_By_Customer_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<CustomerSale>({
      title: 'Sales by Customer Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Customer Name', cell: (r) => r.customerName || 'N/A' },
        { header: 'Contact', cell: (r) => r.contactNumber || '-' },
        { header: 'Payment Terms', cell: (r) => r.paymentTerms || '-' },
        { header: '# Trans', align: 'right', cell: (r) => r.transactionCount },
        { header: 'Total Sales', align: 'right', cell: (r) => r.totalSales },
        { header: 'Total Paid', align: 'right', cell: (r) => r.totalPaid },
        { header: 'Outstanding', align: 'right', cell: (r) => r.outstandingBalance },
        { header: 'Last Purchase', cell: (r) => r.lastPurchaseDate ? format(new Date(r.lastPurchaseDate), 'MMM dd, yyyy') : '-' },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, totals.totalSales.toFixed(2), null, totals.outstanding.toFixed(2), null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 278):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 2: `purchases/by-product/page.tsx`**

Same import updates. Add after `exportToPDF` (after its close near line 155):

```ts
  const exportToExcel = () => {
    const fileName = `Purchases_By_Product_${format(new Date(), 'yyyyMMdd_HHmm')}.xls`;
    const ok = exportReportExcel<ProductPurchase>({
      title: 'Purchases by Product Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Product Name', cell: (r) => r.productName || 'N/A' },
        { header: 'Barcode', cell: (r) => r.barcode || '-' },
        { header: 'Category', cell: (r) => r.category || '-' },
        { header: 'Quantity', align: 'right', cell: (r) => r.totalQuantity },
        { header: 'UOM', cell: (r) => r.uom || '-' },
        { header: 'Avg Cost', align: 'right', cell: (r) => r.avgCost },
        { header: 'Total Spend', align: 'right', cell: (r) => r.totalCost },
      ],
      rows: filteredRecords,
      totals: ['TOTAL', null, null, totals.totalQuantity, null, null, totals.totalCost.toFixed(2)],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 250):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 3: `purchases/by-supplier/page.tsx`**

Same import updates. Add after `exportToPDF` (after its close near line 148):

```ts
  const exportToExcel = () => {
    const fileName = `Purchases_By_Supplier_${format(new Date(), 'yyyyMMdd_HHmm')}.xls`;
    const pct = (v: number) => (totals.totalSpent > 0 ? ((v / totals.totalSpent) * 100).toFixed(1) + '%' : '0%');
    const ok = exportReportExcel<SupplierPurchase>({
      title: 'Purchases by Supplier Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Supplier Name', cell: (r) => r.supplierName || 'N/A' },
        { header: 'Contact Person', cell: (r) => r.contactPerson || '-' },
        { header: 'Total Orders', align: 'right', cell: (r) => r.totalOrders },
        { header: 'Total Spent', align: 'right', cell: (r) => r.totalSpent },
        { header: 'Last Purchase Date', cell: (r) => r.lastPurchaseDate ? format(new Date(r.lastPurchaseDate), 'yyyy-MM-dd') : '-' },
        { header: '% of Total', align: 'right', cell: (r) => pct(r.totalSpent) },
      ],
      rows: filteredRecords,
      totals: ['TOTAL', null, totals.totalOrders, totals.totalSpent.toFixed(2), null, '100%'],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 243):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 4: `purchases/summary/page.tsx`**

Same import updates. Add after `exportToPDF` (after its close near line 157):

```ts
  const exportToExcel = () => {
    const fileName = `Purchases_Summary_${format(new Date(), 'yyyyMMdd_HHmm')}.xls`;
    const ok = exportReportExcel<PurchaseOrder>({
      title: 'Purchases Summary Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'PO ID', cell: (r) => r.id || 'N/A' },
        { header: 'Date', cell: (r) => r.date ? format(new Date(r.date), 'yyyy-MM-dd') : '-' },
        { header: 'Supplier', cell: (r) => r.supplierName || 'N/A' },
        { header: 'Reference', cell: (r) => r.referenceNumber || '-' },
        { header: 'Payment', cell: (r) => r.paymentMethod || '-' },
        { header: 'Status', cell: (r) => r.status || '-' },
        { header: 'Total Amount', align: 'right', cell: (r) => r.total },
      ],
      rows: filteredRecords,
      totals: [null, null, null, null, null, 'TOTAL', totals.totalSpent.toFixed(2)],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 267):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors in any of the four files.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, visit `/reports/sales/by-customer`, `/reports/purchases/by-product`, `/reports/purchases/by-supplier`, `/reports/purchases/summary`. On each: fetch data, search, click "Export to Excel", confirm `.xls` downloads correctly with filtered rows and totals.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/reports/sales/by-customer/page.tsx" "app/(app)/reports/purchases/by-product/page.tsx" "app/(app)/reports/purchases/by-supplier/page.tsx" "app/(app)/reports/purchases/summary/page.tsx"
git commit -m "feat(reports): add Excel export to customer and purchases pages"
```

---

## Task 5: `sales/summary`, `sales/returns`, `sales/discounts`, `sales/batch-profit` — Excel export (search already present)

**Files:**
- Modify: `app/(app)/reports/sales/summary/page.tsx`
- Modify: `app/(app)/reports/sales/returns/page.tsx`
- Modify: `app/(app)/reports/sales/discounts/page.tsx`
- Modify: `app/(app)/reports/sales/batch-profit/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: `sales/summary/page.tsx`**

Update imports (`exportReportExcel`, `FileSpreadsheet`). Add after `exportToPDF` (after its close near line 165):

```ts
  const exportToExcel = () => {
    const subtotalSum = filteredRecords.reduce((s, r) => s + r.subtotal, 0);
    const discountSum = filteredRecords.reduce((s, r) => s + r.discount, 0);
    const taxSum = filteredRecords.reduce((s, r) => s + r.taxAmount, 0);
    const totalSum = filteredRecords.reduce((s, r) => s + r.total, 0);
    const profitSum = filteredRecords.reduce((s, r) => s + r.profit, 0);
    const fileName = `Sales_Summary_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<SalesTransaction>({
      title: 'Sales Summary Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'OR No.', cell: (r) => r.orderNumber || 'N/A' },
        { header: 'Date/Time', cell: (r) => r.date ? format(new Date(r.date), 'MM/dd/yy hh:mma') : '-' },
        { header: 'Customer', cell: (r) => r.customer?.name || 'Walk-in' },
        { header: 'Cashier', cell: (r) => r.cashier || 'N/A' },
        { header: 'Terminal', cell: (r) => r.terminal || 'N/A' },
        { header: 'Payment', cell: (r) => r.paymentMethod || 'N/A' },
        { header: 'Subtotal', align: 'right', cell: (r) => r.subtotal },
        { header: 'Discount', align: 'right', cell: (r) => r.discount },
        { header: 'Tax', align: 'right', cell: (r) => r.taxAmount },
        { header: 'Total', align: 'right', cell: (r) => r.total },
        { header: 'Profit', align: 'right', cell: (r) => r.profit },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, null, null, subtotalSum.toFixed(2), discountSum.toFixed(2), taxSum.toFixed(2), totalSum.toFixed(2), profitSum.toFixed(2)],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 266):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 2: `sales/returns/page.tsx`**

Same import updates. Add after `exportToPDF` (after its close near line 190). Note this page's totals in the original PDF export use the unfiltered `totals` object — since Excel now exports `filteredRecords`, recompute totals from the filtered set for consistency:

```ts
  const exportToExcel = () => {
    const revenueSum = filteredRecords.reduce((s, r) => s + r.salesAmount, 0);
    const costSum = filteredRecords.reduce((s, r) => s + r.cost, 0);
    const profitSum = filteredRecords.reduce((s, r) => s + r.profit, 0);
    const vatableSum = filteredRecords.reduce((s, r) => s + r.vatableSales, 0);
    const vatSum = filteredRecords.reduce((s, r) => s + r.vatAmount, 0);
    const fileName = `Merchandise_Credit_Report_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<ReturnRecord>({
      title: 'Merchandise Credit Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'MC No.', cell: (r) => r.mcNo || '—' },
        { header: 'Orig SI No.', cell: (r) => r.origSiNo },
        { header: 'Trans Date', cell: (r) => r.transDate ? format(new Date(r.transDate), 'MM/dd/yy hh:mma') : '-' },
        { header: 'Sold By', cell: (r) => r.soldByCashier || '-' },
        { header: 'Return Date', cell: (r) => r.returnedDate ? format(new Date(r.returnedDate), 'MM/dd/yy hh:mma') : '-' },
        { header: 'Returned By', cell: (r) => r.returnedByCashier || '-' },
        { header: 'Override By', cell: (r) => r.overrideBy || '-' },
        { header: 'Amount', align: 'right', cell: (r) => r.salesAmount },
        { header: 'Cost', align: 'right', cell: (r) => r.cost },
        { header: 'Profit', align: 'right', cell: (r) => r.profit },
        { header: 'Vatable', align: 'right', cell: (r) => r.vatableSales },
        { header: 'VAT', align: 'right', cell: (r) => r.vatAmount },
        { header: 'Note', cell: (r) => r.note || '-' },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, null, null, null, revenueSum.toFixed(2), costSum.toFixed(2), profitSum.toFixed(2), vatableSum.toFixed(2), vatSum.toFixed(2), null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 285):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 3: `sales/discounts/page.tsx`**

Same import updates. This page's PDF export already uses `rows: filteredRecords` — Excel follows the same, no total-recompute change needed beyond reusing the existing `grandTotal` pattern. Add after `exportToPDF` (after its close near line 160):

```ts
  const exportToExcel = () => {
    const grandTotal = filteredRecords.reduce((sum, r) => sum + r.discountAmount, 0);
    const fileName = `Discount_Report_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<DiscountRecord>({
      title: 'Discount Report (SC / PWD / NAAC / Solo Parent)',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'}  To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Date', cell: (r) => r.transactionDate ? format(new Date(r.transactionDate), 'yyyy-MM-dd HH:mm') : '-' },
        { header: 'OR/SI No.', cell: (r) => String(r.orderNumber || '-').padStart(6, '0') },
        { header: 'Type', cell: (r) => TYPE_LABELS[r.discountType] || r.discountType },
        { header: 'Cardholder Name', cell: (r) => r.holderName || '-' },
        { header: 'ID Number', cell: (r) => r.idNumber || '-' },
        { header: 'Item', cell: (r) => r.productName || '-' },
        { header: 'Disc %', align: 'right', cell: (r) => `${r.discountPercentage.toFixed(0)}%` },
        { header: 'Disc Amount', align: 'right', cell: (r) => r.discountAmount },
        { header: 'Cashier', cell: (r) => r.cashierName || '-' },
      ],
      rows: filteredRecords,
      totals: ['GRAND TOTAL', null, null, null, null, null, `${filteredRecords.length} rec`, grandTotal.toFixed(2), null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 241):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 4: `sales/batch-profit/page.tsx`**

Same import updates. This page's PDF export also already uses `rows: filteredRecords`. Add after `exportToPDF` (after its close near line 163):

```ts
  const exportToExcel = () => {
    const qtySum = filteredRecords.reduce((s, r) => s + r.qtySold, 0);
    const revenueSum = filteredRecords.reduce((s, r) => s + r.lineRevenue, 0);
    const costSum = filteredRecords.reduce((s, r) => s + r.lineCost, 0);
    const profitSum = filteredRecords.reduce((s, r) => s + r.lineProfit, 0);
    const marginPct = revenueSum > 0 ? ((profitSum / revenueSum) * 100).toFixed(1) : '0.0';
    const fileName = `Batch_Profit_Report_${format(new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<BatchAnalysisRecord>({
      title: 'Batch Profit Analysis Report',
      subtitle: `Period: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} to ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Sale Date', cell: (r) => r.saleDate || 'N/A' },
        { header: 'Ref', cell: (r) => r.saleReference },
        { header: 'Product', cell: (r) => r.productName },
        { header: 'Batch ID', cell: (r) => (r.batchId === 'fallback' ? 'Untracked' : r.batchId) },
        { header: 'Qty', align: 'right', cell: (r) => r.qtySold },
        { header: 'U.Cost', align: 'right', cell: (r) => r.unitCost },
        { header: 'U.Sell', align: 'right', cell: (r) => r.unitSellingPrice },
        { header: 'Revenue', align: 'right', cell: (r) => r.lineRevenue },
        { header: 'Cost', align: 'right', cell: (r) => r.lineCost },
        { header: 'Profit', align: 'right', cell: (r) => r.lineProfit },
        { header: 'Margin', align: 'right', cell: (r) => r.marginPct.toFixed(1) + '%' },
      ],
      rows: filteredRecords,
      totals: ['TOTALS', null, null, null, qtySum, null, null, revenueSum.toFixed(2), costSum.toFixed(2), profitSum.toFixed(2), `${marginPct}%`],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export PDF" `Button` (after line 254):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={records.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, visit `/reports/sales/summary`, `/reports/sales/returns`, `/reports/sales/discounts`, `/reports/sales/batch-profit`. On each: fetch data, search, export, confirm totals recompute correctly against the filtered set.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/reports/sales/summary/page.tsx" "app/(app)/reports/sales/returns/page.tsx" "app/(app)/reports/sales/discounts/page.tsx" "app/(app)/reports/sales/batch-profit/page.tsx"
git commit -m "feat(reports): add Excel export to sales summary/returns/discounts/batch-profit pages"
```

---

## Task 6: `sales/split-payments` — Excel export (search already present, nested data flattened)

**Files:**
- Modify: `app/(app)/reports/sales/split-payments/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `exportToExcel`, reusing the PDF export's payment-breakdown flattening**

Update the `@/lib/report-print` import to include `exportReportExcel`, add `FileSpreadsheet` to the lucide-react icon import. Add after `exportToPDF` (after its close near line 177):

```ts
  const exportToExcel = () => {
    const revenueSum = filteredRecords.reduce((s, r) => s + r.total, 0);
    const fileName = `Split_Payments_Report_${format(new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<SplitPaymentTransaction>({
      title: 'Split Payments Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'OR No.', cell: (r) => r.orderNumber },
        { header: 'Date/Time', cell: (r) => format(new Date(r.date), 'MM/dd/yy hh:mma') },
        { header: 'Customer', cell: (r) => r.customer },
        { header: 'Cashier', cell: (r) => r.cashier },
        { header: 'Total', align: 'right', cell: (r) => r.total },
        { header: 'Payment Breakdown', cell: (r) => r.payments.map((p) => `${p.method}: ${p.amount.toFixed(2)}`).join(' | ') },
      ],
      rows: filteredRecords,
      totals: ['TOTAL', null, null, null, revenueSum.toFixed(2), null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button immediately after the existing "Export to PDF" `Button` (line 238):

```tsx
            <Button onClick={exportToExcel} disabled={isLoading || records.length === 0} variant="outline" className="border-emerald-700 text-emerald-700 hover:bg-emerald-50">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, visit `/reports/sales/split-payments`. Fetch data, search, export, confirm the "Payment Breakdown" column shows the flattened `method: amount` pairs matching what the expanded row detail shows on screen.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/reports/sales/split-payments/page.tsx"
git commit -m "feat(reports): add Excel export to split-payments page"
```

---

## Task 7: `fiscal-year`, `membership` — search + Excel export (both currently have `exportReportPdf` but no search box)

**Files:**
- Modify: `app/(app)/reports/fiscal-year/page.tsx`
- Modify: `app/(app)/reports/membership/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1); `ReportSearchInput` from `@/components/reports/ReportSearchInput` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: `fiscal-year/page.tsx` — add search state and filter**

In `app/(app)/reports/fiscal-year/page.tsx`, add a `searchTerm` state next to the existing `report` state (near line 38):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add a `filteredMonths` derived value right before the JSX `return` (or right after `report` is available), filtering on `monthLabel`:

```ts
  const filteredMonths = (report?.months || []).filter((m) => {
    if (!searchTerm.trim()) return true;
    return m.monthLabel.toLowerCase().includes(searchTerm.toLowerCase());
  });
```

Update the `<Table>` body to map over `filteredMonths` instead of `report.months` (the existing render loop around line 219 iterates `report.months.map(...)` — change that iteration source to `filteredMonths.map(...)`).

Import `ReportSearchInput`:

```ts
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
```

Add the search box in the card header row that contains the table (near where the table `CardTitle`/`CardDescription` sits, mirroring how `sales/by-product` places its search box next to `CardTitle`):

```tsx
            <ReportSearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search month..."
            />
```

- [ ] **Step 2: `fiscal-year/page.tsx` — add Excel export**

Update the `@/lib/report-print` import to include `exportReportExcel`; add `FileSpreadsheet` to the lucide-react icon import. Add after `exportToPDF` (after its close near line 99):

```ts
  const exportToExcel = () => {
    if (!report) return;
    const fileName = `Fiscal_Year_${report.label.replace(/\s+/g, '_')}.xls`;
    const ok = exportReportExcel<MonthRow>({
      title: 'Fiscal Year Report',
      subtitle: report.label,
      columns: [
        { header: 'Month', cell: (r) => r.monthLabel },
        { header: 'Transactions', align: 'right', cell: (r) => r.transactions },
        { header: 'Revenue', align: 'right', cell: (r) => r.revenue },
        { header: 'Profit', align: 'right', cell: (r) => r.profit },
      ],
      rows: filteredMonths,
      totals: [
        'TOTALS',
        String(report.summary.transactions),
        report.summary.revenue.toFixed(2),
        report.summary.profit.toFixed(2),
      ],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 153):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || !report}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 3: `membership/page.tsx` — add search state and filter**

Add `searchTerm` state next to the existing `rows` state (near line 43):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add a `filteredRows` derived value, filtering on `customerName` and `rfidCode`:

```ts
  const filteredRows = rows.filter((r) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      r.customerName?.toLowerCase().includes(search) ||
      r.rfidCode?.toLowerCase().includes(search)
    );
  });
```

Update the `<Table>` body to map over `filteredRows` instead of `rows` (the render loop around line 173 iterates `rows.map(...)` — change to `filteredRows.map(...)`).

Import `ReportSearchInput` and place it in the card header next to the table, mirroring Step 1:

```tsx
            <ReportSearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search customer, RFID..."
            />
```

- [ ] **Step 4: `membership/page.tsx` — add Excel export**

Update the `@/lib/report-print` import to include `exportReportExcel`; add `FileSpreadsheet` to the lucide-react icon import. Add after `exportToPDF` (after its close near line 102):

```ts
  const exportToExcel = () => {
    const collectedSum = filteredRows.reduce((s, r) => s + r.amount, 0);
    const fileName = `Membership_${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<MembershipRow>({
      title: 'Membership Report',
      subtitle: `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'} To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`,
      columns: [
        { header: 'Date', cell: (r) => format(new Date(r.createdAt), 'MMM dd, yyyy') },
        { header: 'Customer', cell: (r) => r.customerName },
        { header: 'RFID', cell: (r) => r.rfidCode || '-' },
        { header: 'Type', cell: (r) => r.type === 'activation' ? 'Activation' : 'Renewal' },
        { header: 'Amount', align: 'right', cell: (r) => r.amount },
        { header: 'Method', cell: (r) => r.paymentMethod.toUpperCase() },
        { header: 'Cashier', cell: (r) => r.cashierName },
        { header: 'Valid Until', cell: (r) => format(new Date(r.newExpiry), 'MMM dd, yyyy') },
      ],
      rows: filteredRows,
      totals: ['TOTALS', null, null, null, collectedSum.toFixed(2), null, null, null],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert button after the existing "Export to PDF" `Button` (after line 143):

```tsx
            <Button
              onClick={exportToExcel}
              disabled={isLoading || rows.length === 0}
              variant="outline"
              className="border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, visit `/reports/fiscal-year` and `/reports/membership`. On each: fetch data, type into the new search box and confirm rows filter, click "Export to Excel" and confirm the file matches the filtered rows.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/reports/fiscal-year/page.tsx" "app/(app)/reports/membership/page.tsx"
git commit -m "feat(reports): add search and Excel export to fiscal-year and membership pages"
```

---

## Task 8: `adjustments`, `movements`, `velocity` — search + Excel export (currently `printReportTable`-only, no search)

**Files:**
- Modify: `app/(app)/reports/adjustments/page.tsx`
- Modify: `app/(app)/reports/movements/page.tsx`
- Modify: `app/(app)/reports/velocity/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1); `ReportSearchInput` from `@/components/reports/ReportSearchInput` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: `adjustments/page.tsx` — add search state and filter**

Add `searchTerm` state next to the existing `adjustments` state (near line 35):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add a `filteredAdjustments` derived value, filtering on product name, barcode, and reason:

```ts
  const filteredAdjustments = adjustments.filter((a) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      a.product_name?.toLowerCase().includes(search) ||
      a.barcode?.toLowerCase().includes(search) ||
      a.reason?.toLowerCase().includes(search)
    );
  });
```

Update the table body's render loop (which currently maps `adjustments`, near where `<TableBody>` renders rows) to map `filteredAdjustments` instead.

Import `ReportSearchInput`:

```ts
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
```

Place the search box in the page's header row (the same `flex items-center justify-between` div that holds the "Print Report" button, near line 127), before or after the date-range controls:

```tsx
        <ReportSearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search product, reason..."
        />
```

- [ ] **Step 2: `adjustments/page.tsx` — add Excel export**

Update the `@/lib/report-print` import to include `exportReportExcel` alongside `printReportTable`. Add `FileSpreadsheet` to the lucide-react icon import (alongside the existing `Printer`/`Loader2`). Add a new `exportToExcel` function next to `handlePrint`:

```ts
  const exportToExcel = () => {
    const fileName = `Stock_Adjustments_${format(new Date(startDate), 'yyyyMMdd')}_${format(new Date(endDate), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<Adjustment>({
      title: 'Stock Adjustment Report',
      subtitle: `${startDate} to ${endDate}`,
      columns: [
        { header: 'Date', cell: (a) => format(new Date(a.created_at), 'MMM dd, yyyy HH:mm') },
        { header: 'Product', cell: (a) => a.product_name },
        { header: 'Barcode', cell: (a) => a.barcode || '-' },
        { header: 'Reason', cell: (a) => a.reason },
        { header: 'Adjustment', align: 'right', cell: (a) => `${a.quantity > 0 ? '+' : ''}${a.quantity}` },
        { header: 'New Stock', align: 'right', cell: (a) => a.new_stock },
      ],
      rows: filteredAdjustments,
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Note: this page has no `useToast` import currently if it only prints — check the top of the file; if `toast`/`useToast` isn't already imported, add:

```ts
import { useToast } from '@/hooks/use-toast';
```

and inside the component, if not already present:

```ts
  const { toast } = useToast();
```

Insert the button next to the existing "Print Report" `Button` (after line 130):

```tsx
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={filteredAdjustments.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </Button>
```

- [ ] **Step 3: `movements/page.tsx` — add search state and filter**

Add `searchTerm` state next to the existing `movements` state (near line 47):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add a `filteredMovements` derived value, filtering on product name, barcode, and reference/notes:

```ts
  const filteredMovements = movements.filter((m) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      m.product_name?.toLowerCase().includes(search) ||
      m.barcode?.toLowerCase().includes(search) ||
      m.notes?.toLowerCase().includes(search)
    );
  });
```

Update the table body's render loop to map `filteredMovements` instead of `movements`.

Import and place `ReportSearchInput` in the header row (near line 126, alongside the "Print Report" button and the type/date filters):

```tsx
        <ReportSearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search product, reference..."
        />
```

- [ ] **Step 4: `movements/page.tsx` — add Excel export**

Update the `@/lib/report-print` import to include `exportReportExcel`. Add `FileSpreadsheet` to the icon import. Add `exportToExcel` next to `handlePrint`:

```ts
  const exportToExcel = () => {
    const fileName = `Stock_Movements_${format(new Date(startDate), 'yyyyMMdd')}_${format(new Date(endDate), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<StockMovement>({
      title: 'Stock Movement Report',
      subtitle: `${startDate} to ${endDate}`,
      columns: [
        { header: 'Date', cell: (m) => format(new Date(m.created_at), 'MMM dd, yyyy HH:mm') },
        { header: 'Type', cell: (m) => capitalize(m.movement_type) },
        { header: 'Product', cell: (m) => m.product_name },
        { header: 'Barcode', cell: (m) => m.barcode || '-' },
        { header: 'Change', align: 'right', cell: (m) => `${m.quantity_change > 0 ? '+' : ''}${m.quantity_change}` },
        { header: 'Balance', align: 'right', cell: (m) => m.new_stock },
        { header: 'Reference', cell: (m) => `${capitalize(m.reference_type || '')}${m.notes ? ` - ${m.notes}` : ''}`.trim() || '-' },
      ],
      rows: filteredMovements,
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Verify `useToast`/`toast` is imported/available (add if missing, same as Step 2). Insert the button next to the existing "Print Report" `Button` (after line 129):

```tsx
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={filteredMovements.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </Button>
```

- [ ] **Step 5: `velocity/page.tsx` — add search state and filter**

Add `searchTerm` state next to the existing `products`/`activeTab` state (near line 41):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add a `filteredProducts` derived value, filtering on product name and barcode:

```ts
  const filteredProducts = products.filter((p) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      p.name?.toLowerCase().includes(search) ||
      p.barcode?.toLowerCase().includes(search)
    );
  });
```

Update the table body's render loop (inside the `Tabs`/`TabsContent`, currently mapping `products`) to map `filteredProducts` instead — this applies across all three tabs since `products` already holds the server-filtered active-tab dataset.

Import and place `ReportSearchInput` in the page header (near line 140, alongside "Print Report" and the `Tabs`):

```tsx
        <ReportSearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search product, barcode..."
        />
```

- [ ] **Step 6: `velocity/page.tsx` — add Excel export**

Update the `@/lib/report-print` import to include `exportReportExcel`. Add `FileSpreadsheet` to the icon import. Add `exportToExcel` next to `handlePrint`, exporting only the active tab's filtered data (matches existing print behavior, which is already scoped per-tab via `tabLabel(activeTab)`):

```ts
  const exportToExcel = () => {
    const fileName = `Product_Velocity_${tabLabel(activeTab).replace(/\s+/g, '_')}_${format(new Date(startDate), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<VelocityProduct>({
      title: `Product Velocity Report — ${tabLabel(activeTab)}`,
      subtitle: `${startDate} to ${endDate}`,
      columns: [
        { header: 'Barcode', cell: (p) => p.barcode || '-' },
        { header: 'Product Name', cell: (p) => p.name },
        { header: 'Category', cell: (p) => p.category },
        { header: 'Units Sold (30d)', align: 'right', cell: (p) => p.total_sold },
        { header: 'Revenue Generated', align: 'right', cell: (p) => p.total_revenue },
        { header: 'Current Stock', align: 'right', cell: (p) => p.stock },
      ],
      rows: filteredProducts,
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No data available to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Verify `useToast`/`toast` is imported/available (add if missing). Insert the button next to the existing "Print Report" `Button` (after line 143):

```tsx
        <Button
          onClick={exportToExcel}
          variant="outline"
          className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
          disabled={filteredProducts.length === 0}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Export to Excel
        </Button>
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors in any of the three files.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, visit `/reports/adjustments`, `/reports/movements`, `/reports/velocity`. On each: fetch data, type into the new search box and confirm rows filter, click "Export to Excel" and confirm the file matches the filtered rows. On velocity, switch tabs (fast/slow/none) and confirm export reflects the active tab.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/reports/adjustments/page.tsx" "app/(app)/reports/movements/page.tsx" "app/(app)/reports/velocity/page.tsx"
git commit -m "feat(reports): add search and Excel export to adjustments, movements, velocity pages"
```

---

## Task 9: `cost-vs-retail`, `inventory` — search + Excel export (currently `printReportTable`-only, no search)

**Files:**
- Modify: `app/(app)/reports/cost-vs-retail/page.tsx`
- Modify: `app/(app)/reports/inventory/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1); `ReportSearchInput` from `@/components/reports/ReportSearchInput` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: `cost-vs-retail/page.tsx` — add search state and filter**

Add `searchTerm` state next to the existing `rows` state (near line 49):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add a `filteredRows` derived value, filtering on product name and category (these pages already have a category `Select` filter server-side; this adds a client-side text search on top of whatever's fetched):

```ts
  const filteredRows = rows.filter((r) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      r.name?.toLowerCase().includes(search) ||
      r.category?.toLowerCase().includes(search)
    );
  });
```

Update the table body's render loop (currently mapping `rows`, near line 228+) to map `filteredRows` instead. Also update the existing `handlePrint`'s `rows: printRows` — leave `printRows`/print behavior untouched (print already has its own summary logic); only the on-screen table and the new Excel export use `filteredRows`.

Import and place `ReportSearchInput` in the page header (near line 169, alongside the "Print Report" button and category `Select`):

```tsx
        <ReportSearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search product, category..."
        />
```

- [ ] **Step 2: `cost-vs-retail/page.tsx` — add Excel export**

Update the `@/lib/report-print` import to include `exportReportExcel`. Add `FileSpreadsheet` to the icon import. Add `exportToExcel` next to `handlePrint`:

```ts
  const marginOf = (retailValue: number, profit: number) => (retailValue > 0 ? (profit / retailValue) * 100 : 0);

  const exportToExcel = () => {
    const costValueSum = filteredRows.reduce((s, r) => s + r.cost_value, 0);
    const retailValueSum = filteredRows.reduce((s, r) => s + r.retail_value, 0);
    const profitSum = filteredRows.reduce((s, r) => s + r.profit, 0);
    const marginPct = retailValueSum > 0 ? ((profitSum / retailValueSum) * 100).toFixed(1) : '0.0';
    const fileName = `Cost_vs_Retail_${format(new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<Row>({
      title: 'Cost vs Retail Valuation',
      subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
      columns: [
        { header: 'Product Name', cell: (r) => r.name },
        { header: 'Category', cell: (r) => r.category },
        { header: 'Stock', align: 'right', cell: (r) => `${formatStockQuantity(r.stock)} ${r.unit_of_measure || ''}`.trim() },
        { header: 'Cost', align: 'right', cell: (r) => r.cost },
        { header: 'Price', align: 'right', cell: (r) => r.price },
        { header: 'Cost Value', align: 'right', cell: (r) => r.cost_value },
        { header: 'Retail Value', align: 'right', cell: (r) => r.retail_value },
        { header: 'Profit', align: 'right', cell: (r) => r.profit },
        { header: 'Margin %', align: 'right', cell: (r) => `${marginOf(r.retail_value, r.profit).toFixed(1)}%` },
      ],
      rows: filteredRows,
      totals: ['TOTALS', null, null, null, null, costValueSum.toFixed(2), retailValueSum.toFixed(2), profitSum.toFixed(2), `${marginPct}%`],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Note: if `marginOf` is already defined elsewhere in the file (it's used inside `handlePrint`'s columns per the extraction notes), do not redeclare it — reuse the existing one and drop the `const marginOf = ...` line above.

Verify `useToast`/`toast` is imported/available (add if missing). Insert the button next to the existing "Print Report" `Button` (after line 172):

```tsx
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={filteredRows.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </Button>
```

- [ ] **Step 3: `inventory/page.tsx` — add search state and filter**

Add `searchTerm` state next to the existing `products` state (near line 61):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add a `filteredProducts` derived value, filtering on name, barcode, category:

```ts
  const filteredProducts = products.filter((p) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      p.name?.toLowerCase().includes(search) ||
      p.barcode?.toLowerCase().includes(search) ||
      p.category?.toLowerCase().includes(search)
    );
  });
```

Update the table body's render loop (currently mapping `products`, near line 264+) to map `filteredProducts` instead.

Import and place `ReportSearchInput` in the page header (near line 197, alongside "Print Report" and the category `Select`):

```tsx
        <ReportSearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search product, barcode, category..."
        />
```

- [ ] **Step 4: `inventory/page.tsx` — add Excel export**

Update the `@/lib/report-print` import to include `exportReportExcel`. Add `FileSpreadsheet` to the icon import. Add `exportToExcel` next to `handlePrint`:

```ts
  const exportToExcel = () => {
    const totalValueSum = filteredProducts.reduce((s, p) => s + p.total_value, 0);
    const fileName = `Stock_On_Hand_${format(new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<Product>({
      title: 'Stock on Hand Report',
      subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
      columns: [
        { header: 'Product Name', cell: (p) => p.name },
        { header: 'Barcode', cell: (p) => p.barcode || '-' },
        { header: 'Category', cell: (p) => p.category },
        { header: 'Cost', align: 'right', cell: (p) => p.cost },
        { header: 'Price', align: 'right', cell: (p) => p.price },
        { header: 'Stock', align: 'right', cell: (p) => `${formatStockQuantity(p.stock)} ${p.unit_of_measure || ''}`.trim() },
        { header: 'Total Value', align: 'right', cell: (p) => p.total_value },
      ],
      rows: filteredProducts,
      totals: ['TOTALS', null, null, null, null, null, totalValueSum.toFixed(2)],
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Verify `useToast`/`toast` is imported/available (add if missing). Insert the button next to the existing "Print Report" `Button` (after line 197):

```tsx
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={filteredProducts.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </Button>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, visit `/reports/cost-vs-retail` and `/reports/inventory`. On each: fetch data, search, export, confirm totals match the filtered set.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/reports/cost-vs-retail/page.tsx" "app/(app)/reports/inventory/page.tsx"
git commit -m "feat(reports): add search and Excel export to cost-vs-retail and inventory pages"
```

---

## Task 10: `low-stock` — Excel export only (search already present, server-side)

**Files:**
- Modify: `app/(app)/reports/low-stock/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add Excel export using the already-fetched `products` array**

This page's search is server-side (`search` query param via `searchQuery` state) — the fetched `products` array already reflects the active search, so no client `.filter()` is needed; export directly from `products`.

Add the `@/lib/report-print` import (this page currently has no `report-print` import at all — it builds its print HTML manually):

```ts
import { exportReportExcel } from '@/lib/report-print';
```

Add `FileSpreadsheet` to the lucide-react icon import (line 15, currently `Loader2, Printer, AlertTriangle, Search, X`):

```ts
import { Loader2, Printer, AlertTriangle, Search, X, FileSpreadsheet } from 'lucide-react';
```

Add `exportToExcel` next to `handlePrint`:

```ts
  const exportToExcel = () => {
    const fileName = `Low_Stock_Report_${format(new Date(), 'yyyyMMdd')}.xls`;
    const ok = exportReportExcel<Product>({
      title: 'Low Stock Report',
      subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
      columns: [
        { header: 'Product Name', cell: (p) => p.name },
        { header: 'Barcode', cell: (p) => p.barcode || '-' },
        { header: 'Category', cell: (p) => p.category || '-' },
        { header: 'Current Stock', align: 'right', cell: (p) => `${formatStockQuantity(p.stock)} ${p.unit_of_measure || ''}`.trim() },
        { header: 'Reorder Point', align: 'right', cell: (p) => formatStockQuantity(p.reorder_point) },
        { header: 'Status', cell: () => 'Restock Needed' },
      ],
      rows: products,
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Verify `useToast`/`toast` is imported/available (add if missing, following the same pattern as other pages).

Insert the button next to the existing "Print Report" `Button` (after line 210):

```tsx
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={products.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </Button>
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, visit `/reports/low-stock`. Search for a product, click "Export to Excel", confirm the downloaded file matches the search-filtered results currently on screen.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/reports/low-stock/page.tsx"
git commit -m "feat(reports): add Excel export to low-stock page"
```

---

## Task 11: `expiring-soon` — search + Excel export (two tables, no export today, active-section-only)

**Files:**
- Modify: `app/(app)/reports/expiring-soon/page.tsx`

**Interfaces:**
- Consumes: `exportReportExcel` from `@/lib/report-print` (Task 1); `ReportSearchInput` from `@/components/reports/ReportSearchInput` (Task 2).
- Produces: nothing consumed by later tasks.

This page shows two separate tables (expired, upcoming) with no tab switcher — both are visible at once. Per the spec's "active tab/section only" rule for multi-section pages, and since both sections are simultaneously visible here (unlike velocity's tabs), export both sections in one file as two totals-free blocks, filtered by the same search term.

- [ ] **Step 1: Add search state and filtered derivations**

Add `searchTerm` state next to the existing `items` state (near line 22):

```ts
  const [searchTerm, setSearchTerm] = useState('');
```

Add filtered derivations right after the existing `expired`/`upcoming` split (lines 35-36 per the extraction — those filter on `isExpired`; add search on top):

```ts
  const filteredItems = items.filter((item) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      item.productName?.toLowerCase().includes(search) ||
      item.sku?.toLowerCase().includes(search)
    );
  });
  const filteredExpired = filteredItems.filter((i) => i.isExpired);
  const filteredUpcoming = filteredItems.filter((i) => !i.isExpired);
```

Update `renderRows(expired)` and `renderRows(upcoming)` call sites in the JSX to `renderRows(filteredExpired)` and `renderRows(filteredUpcoming)` respectively.

Import and place `ReportSearchInput` in the header div (the `flex items-center justify-between` div near line 57-70 that currently holds only the days-window `Select`):

```tsx
        <ReportSearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search product, SKU..."
        />
```

- [ ] **Step 2: Add Excel export covering both sections**

Add the import:

```ts
import { exportReportExcel } from '@/lib/report-print';
```

Add `FileSpreadsheet` and `Search`/`X` (for `ReportSearchInput`'s own imports, already self-contained — no extra icon import needed here beyond `FileSpreadsheet`) to the icon import list. Add `useToast`/`toast` if not already present.

Add `exportToExcel`, exporting expired and upcoming as one combined sheet with a "Status" column disambiguating them (simplest single-file approach for two always-visible sections, avoiding a second file/download per click):

```ts
  const exportToExcel = () => {
    const fileName = `Expiring_Soon_${format(new Date(), 'yyyyMMdd')}.xls`;
    const combined = [
      ...filteredExpired.map((i) => ({ ...i, statusLabel: `Expired ${Math.abs(i.daysUntilExpiry)}d ago` })),
      ...filteredUpcoming.map((i) => ({ ...i, statusLabel: `${i.daysUntilExpiry}d left` })),
    ];
    const ok = exportReportExcel<typeof combined[number]>({
      title: 'Expiring Soon Report',
      subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
      columns: [
        { header: 'Product', cell: (r) => r.productName },
        { header: 'SKU', cell: (r) => r.sku || '—' },
        { header: 'Qty', align: 'right', cell: (r) => r.quantityRemaining },
        { header: 'Expires', cell: (r) => r.expirationDate },
        { header: 'Status', cell: (r) => r.statusLabel },
      ],
      rows: combined,
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };
```

Insert the button in the same header div as the search box (near line 57-70, alongside the days-window `Select`):

```tsx
        <Button
          onClick={exportToExcel}
          variant="outline"
          className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
          disabled={filteredItems.length === 0}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Export to Excel
        </Button>
```

Import `Button` from `@/components/ui/button` if not already imported in this file (verify — the extraction notes show no button exists on this page today, so `Button` may not yet be imported).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, visit `/reports/expiring-soon`. Search, confirm both tables filter together. Export, confirm the `.xls` contains both expired and upcoming rows with a correct Status column.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/reports/expiring-soon/page.tsx"
git commit -m "feat(reports): add search and Excel export to expiring-soon page"
```

---

## Task 12: Final sweep — lint and typecheck across all touched files

**Files:**
- None new — verification only.

**Interfaces:**
- Consumes: all files touched in Tasks 1-11.
- Produces: nothing.

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors attributable to any file touched in this plan. (The codebase may have pre-existing unrelated typecheck failures per project memory — confirm any remaining errors are not in files this plan touched.)

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no new lint errors in files touched by this plan. (Pre-existing lint failures elsewhere in the codebase are out of scope.)

- [ ] **Step 3: Full manual walkthrough**

Run: `npm run dev`. Visit every one of the ~22 pages touched by this plan (skip `sales/bir-summary`, out of scope). On each: confirm a search box is present and filters the table, and clicking "Export to Excel" downloads a `.xls` file that opens correctly (Excel, LibreOffice Calc, or Google Sheets) with headers, rows, and totals matching the on-screen filtered table.

- [ ] **Step 4: Commit any final fixes**

If Steps 1-3 surface issues, fix them in the relevant page file(s) and commit:

```bash
git add <fixed files>
git commit -m "fix(reports): address typecheck/lint/manual QA findings from search+Excel rollout"
```
