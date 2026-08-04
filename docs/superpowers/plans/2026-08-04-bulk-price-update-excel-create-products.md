# Bulk Price Update — Lean Template + Auto-Create Missing Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Download Template" produces a 3-sample-row file (not the whole catalog) with new identity columns (`name`/`brand`/`category`/`unit_of_measure`); an uploaded row with no matching product but all four identity fields filled in is classified as a new product to create instead of being skipped, shown in its own preview section, gated behind an explicit confirmation, and created via the existing `addProduct` action (inheriting its `PRODUCT_CREATE` approval gate).

**Architecture:** `price-list-template.ts` gains the new columns and a caller-side 3-row slice. `PriceListRow`/`PriceListPreviewResult` in `bulk-price-update/actions.ts` gain a `toCreate` classification path inside `previewPriceListUpload`, plus a new `NewProductFromExcel` type. A new `createProductsFromExcel` action loops `addProduct` per row — no new parallel creation logic. `UploadPriceListDialog.tsx`/`use-upload-price-list.ts` render a second preview table and a confirmation checkbox that gates submission whenever any row would create a product.

**Tech Stack:** Next.js 16 (App Router, server actions), `xlsx` (client-side), MySQL via `mysql2/promise` (`lib/mysql.ts`), shadcn/ui (`Checkbox`, `Table`), Playwright for E2E.

## Global Constraints

- No new database tables or columns — new products are created via the existing `products` table INSERT path inside `addProduct`.
- Reuse `addProduct` (`app/(app)/products/actions.ts`) for all new-product creation — do not build a second, parallel creation code path. Each row independently goes through `addProduct`'s existing `PRODUCT_CREATE` approval gate.
- `description` is not a new template column — a to-create row's `description` defaults to its `name` when calling `addProduct`.
- Price levels remain out of scope for the Excel path (drawer-only, unchanged) — a to-create row only sets `price`/`cost`, never `priceLevels`.
- Follow existing house style: `'use server'` action files export plain async functions; DB access via `query`/`withTransaction` from `lib/mysql.ts`; no ORM.

---

### Task 1: Lean template, new columns, and preview classification

**Files:**
- Modify: `app/(app)/products/bulk-price-update/price-list-template.ts`
- Modify: `app/(app)/products/bulk-price-update/actions.ts` (`PriceListRow`, new `NewProductFromExcel`, `PriceListPreviewResult`, `previewPriceListUpload`)
- Modify: `app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx` (Download Template call site)
- Test: manual (Step 6 script)

**Interfaces:**
- Consumes: `isValidPriceValue` from `@/lib/price-update-math` (existing).
- Produces: `PriceListRow` gains `name?`, `brand?`, `category?`, `unitOfMeasure?: string`; `export interface NewProductFromExcel { sku: string; barcode: string; name: string; brand: string; category: string; unitOfMeasure: string; price: number; cost?: number; }`; `PriceListPreviewResult` gains `toCreate: NewProductFromExcel[]`. Consumed by Task 2 (`createProductsFromExcel`) and Task 3 (UI).

- [ ] **Step 1: Update the template file and row-mapping helper**

Replace the full content of `app/(app)/products/bulk-price-update/price-list-template.ts`:

```ts
import * as XLSX from 'xlsx';
import type { ParsedFile } from '@/lib/import/parse-file';
import type { PriceListRow } from './actions';

interface TemplateProduct {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unitOfMeasure: string;
  price: number;
  cost: number;
}

export function downloadPriceListTemplate(products: TemplateProduct[], warehouseName: string) {
  const header = ['sku', 'barcode', 'name', 'brand', 'category', 'unit_of_measure', 'current_price', 'current_cost', 'current_markup_pct', 'new_price', 'new_cost', 'new_markup_pct'];
  const rows = products.map(p => {
    const markup = p.cost > 0 ? Math.round(((p.price / p.cost) - 1) * 10000) / 100 : 0;
    return [p.sku, p.barcode, p.name, p.brand, p.category, p.unitOfMeasure, p.price, p.cost, markup, '', '', ''];
  });
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
  const safeName = warehouseName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  XLSX.writeFile(wb, `price-list-${safeName}.xlsx`);
}

/** Maps parsed sheet rows (raw header/rows from parseFile) into typed PriceListRow entries. */
export function mapParsedRowsToPriceListRows(parsed: ParsedFile): PriceListRow[] {
  const num = (v: string | undefined): number | undefined => {
    if (v == null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN; // NaN signals "present but invalid" to the caller
  };
  const str = (v: string | undefined): string | undefined => {
    const t = (v || '').trim();
    return t === '' ? undefined : t;
  };
  return parsed.rows.map(row => ({
    sku: row.sku || '',
    barcode: row.barcode || '',
    name: str(row.name),
    brand: str(row.brand),
    category: str(row.category),
    unitOfMeasure: str(row.unit_of_measure),
    newPrice: num(row.new_price),
    newCost: num(row.new_cost),
    newMarkupPct: num(row.new_markup_pct),
  }));
}
```

- [ ] **Step 2: Update the Download Template call site to pass 3 sample rows with the new fields**

In `app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx`, replace the `onClick` handler on the "Download Template" button:

```tsx
                  onClick={() => downloadPriceListTemplate(
                    bp.products.slice(0, 3).map((p: any) => ({
                      sku: p.sku, barcode: p.barcode || '', name: p.name,
                      brand: p.brand || '', category: p.category || '', unitOfMeasure: p.unitOfMeasure || '',
                      price: Number(p.price), cost: Number(p.cost || 0),
                    })),
                    productOptions.warehouses?.find(w => w.id === bp.warehouseId)?.name || 'warehouse',
                  )}
```

- [ ] **Step 3: Update the types in `actions.ts`**

Replace `PriceListRow` and `PriceListPreviewResult` (currently lines 147-158):

```ts
export interface PriceListRow {
  sku: string;
  barcode: string;
  name?: string;
  brand?: string;
  category?: string;
  unitOfMeasure?: string;
  newPrice?: number;
  newCost?: number;
  newMarkupPct?: number;
}

export interface NewProductFromExcel {
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: string;
  unitOfMeasure: string;
  price: number;
  cost?: number;
}

export interface PriceListPreviewResult {
  matched: PriceUpdateItem[];
  toCreate: NewProductFromExcel[];
  skipped: { row: PriceListRow; reason: string }[];
}
```

- [ ] **Step 4: Classify unmatched rows in `previewPriceListUpload`**

Replace the function's body (currently lines 160-250) — this keeps every existing matched/skipped code path byte-identical and only changes the `if (!product)` branch (previously an unconditional skip) plus the initial state and final return:

```ts
export async function previewPriceListUpload(
  warehouseId: string,
  rows: PriceListRow[],
): Promise<PriceListPreviewResult> {
  const matched: PriceUpdateItem[] = [];
  const toCreate: NewProductFromExcel[] = [];
  const skipped: PriceListPreviewResult['skipped'] = [];
  const seenSkus = new Set<string>();

  for (const row of rows) {
    const sku = (row.sku || '').trim();
    const barcode = (row.barcode || '').trim();

    if (!sku && !barcode) {
      skipped.push({ row, reason: 'Missing SKU and barcode' });
      continue;
    }
    if (sku && seenSkus.has(sku)) {
      skipped.push({ row, reason: `Duplicate SKU "${sku}" (earlier row in this file superseded)` });
      continue;
    }

    let product: any;
    if (sku) {
      const bySku: any = await query(
        'SELECT id, name, sku, barcode, price, cost FROM products WHERE sku = ? AND warehouse_id = ? LIMIT 1',
        [sku, warehouseId],
      );
      product = bySku?.[0];
    }
    if (!product && barcode) {
      const byBarcode: any = await query(
        'SELECT id, name, sku, barcode, price, cost FROM products WHERE barcode = ? AND warehouse_id = ? LIMIT 1',
        [barcode, warehouseId],
      );
      product = byBarcode?.[0];
    }
    if (!product) {
      // Unmatched: with enough identity data + a price, treat this as a new
      // product to create rather than an unconditional skip. Reusing
      // `newPrice` as the initial price — a to-create row has no "old"
      // value to update from.
      const missing: string[] = [];
      if (!row.name) missing.push('name');
      if (!row.brand) missing.push('brand');
      if (!row.category) missing.push('category');
      if (!row.unitOfMeasure) missing.push('unit_of_measure');
      if (row.newPrice == null) missing.push('new_price');

      if (missing.length > 0) {
        skipped.push({ row, reason: `Product not found and missing required fields to create it: ${missing.join(', ')}` });
        continue;
      }
      if (!isValidPriceValue(row.newPrice!)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
        continue;
      }
      if (row.newCost != null && !isValidPriceValue(row.newCost)) {
        skipped.push({ row, reason: 'new_cost must be a non-negative number' });
        continue;
      }
      if (sku) seenSkus.add(sku);
      toCreate.push({
        sku, barcode, name: row.name!, brand: row.brand!, category: row.category!, unitOfMeasure: row.unitOfMeasure!,
        price: row.newPrice!, cost: row.newCost,
      });
      continue;
    }
    if (sku) seenSkus.add(sku);

    if (row.newPrice != null) {
      if (!isValidPriceValue(row.newPrice)) {
        skipped.push({ row, reason: 'new_price must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'price', oldValue: parseFloat(product.price), newValue: row.newPrice,
          adjustmentType: 'exact', adjustmentValue: row.newPrice,
        });
      }
    }
    if (row.newCost != null) {
      if (!isValidPriceValue(row.newCost)) {
        skipped.push({ row, reason: 'new_cost must be a non-negative number' });
      } else {
        matched.push({
          productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
          field: 'cost', oldValue: parseFloat(product.cost || 0), newValue: row.newCost,
          adjustmentType: 'exact', adjustmentValue: row.newCost,
        });
      }
    }
    if (row.newMarkupPct != null) {
      // Unlike price/cost, a markup % can legitimately be negative (a
      // markdown), so the bar here is "is it a real number" rather than
      // "is it non-negative" — but NaN (a non-numeric Excel cell) must never
      // reach `matched`.
      if (!Number.isFinite(row.newMarkupPct)) {
        skipped.push({ row, reason: 'new_markup_pct must be a number' });
      } else {
        const liveCost = parseFloat(product.cost || 0);
        const newPrice = applyAdjustment('markup', 0, row.newMarkupPct, liveCost);
        // Guards a corrupt/NaN product.cost (or any other non-finite/negative
        // result of the markup computation) from ever reaching `matched`.
        if (!isValidPriceValue(newPrice)) {
          skipped.push({ row, reason: 'Computed price from new_markup_pct is invalid (check product cost)' });
        } else {
          matched.push({
            productId: product.id, sku: product.sku, barcode: product.barcode || '', productName: product.name,
            field: 'price', oldValue: parseFloat(product.price), newValue: newPrice,
            adjustmentType: 'markup', adjustmentValue: row.newMarkupPct,
          });
        }
      }
    }
  }

  return { matched, toCreate, skipped };
}
```

Note the `if (sku) seenSkus.add(sku);` inside the `toCreate` branch — this means a later row in the same file reusing that same SKU (whether for another to-create attempt or a matched-product update) is caught by the existing duplicate-SKU check at the top of the loop, satisfying the design's "duplicate SKU among to-create rows" requirement without new code.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors in `price-list-template.ts`, `actions.ts`, or `BulkPriceUpdateDrawer.tsx` (pre-existing baseline errors in unrelated files are expected).

- [ ] **Step 6: Manual smoke test of the classification logic**

```bash
node -e "
const mysql = require('mysql2/promise');
(async()=>{
  const conn = await mysql.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'rootpassword',database:'verdix'});
  const [wh] = await conn.query('SELECT id FROM warehouses LIMIT 1');
  console.log('warehouse for manual verification:', wh[0]);
  await conn.end();
})();
"
```
Then, via `npx tsx` (project-relative script, see Task 6's Step 4 in the original bulk-price-update plan for the working pattern with `'use server'` action imports):
```ts
import { previewPriceListUpload } from '../app/(app)/products/bulk-price-update/actions';
(async () => {
  const result = await previewPriceListUpload('<warehouseId from above>', [
    { sku: 'DOES-NOT-EXIST-1', barcode: '', name: 'New Test Product', brand: 'TestBrand', category: 'TestCategory', unitOfMeasure: 'pcs', newPrice: 50 },
    { sku: 'DOES-NOT-EXIST-2', barcode: '', newPrice: 50 }, // missing identity fields
  ]);
  console.log(JSON.stringify(result, null, 2));
})();
```
Expected: `toCreate` has exactly one entry (`DOES-NOT-EXIST-1`); `skipped` has exactly one entry for `DOES-NOT-EXIST-2` naming `name, brand, category, unit_of_measure` as missing.

- [ ] **Step 7: Commit**

```bash
git add app/(app)/products/bulk-price-update/price-list-template.ts app/(app)/products/bulk-price-update/actions.ts app/(app)/products/bulk-price-update/BulkPriceUpdateDrawer.tsx
git commit -m "feat: lean price-list template + classify unmatched rows as new products"
```

---

### Task 2: Create products from classified rows

**Files:**
- Modify: `app/(app)/products/bulk-price-update/actions.ts` (new `createProductsFromExcel`)
- Test: manual (Step 3 script)

**Interfaces:**
- Consumes: `NewProductFromExcel` from Task 1; `addProduct` from `app/(app)/products/actions.ts` (existing, already approval-gated).
- Produces: `export interface CreateProductsResult { created: number; pendingApproval: number; failed: { row: NewProductFromExcel; reason: string }[]; }` and `export async function createProductsFromExcel(warehouseId: string, rows: NewProductFromExcel[], userId: string): Promise<CreateProductsResult>`, consumed by Task 3's UI.

- [ ] **Step 1: Add the import**

At the top of `app/(app)/products/bulk-price-update/actions.ts`, add:

```ts
import { addProduct } from '@/app/(app)/products/actions';
```

- [ ] **Step 2: Implement `createProductsFromExcel`**

Add at the end of the file:

```ts
export interface CreateProductsResult {
  created: number;
  pendingApproval: number;
  failed: { row: NewProductFromExcel; reason: string }[];
}

export async function createProductsFromExcel(
  warehouseId: string,
  rows: NewProductFromExcel[],
  userId: string,
): Promise<CreateProductsResult> {
  let created = 0;
  let pendingApproval = 0;
  const failed: CreateProductsResult['failed'] = [];

  for (const row of rows) {
    try {
      const result = await addProduct({
        name: row.name,
        brand: row.brand,
        sku: row.sku,
        barcode: row.barcode || undefined,
        description: row.name,
        category: row.category,
        warehouse: warehouseId,
        unitOfMeasure: row.unitOfMeasure,
        stock: 0,
        reorderPoint: 0,
        price: row.price,
        cost: row.cost,
      } as any, userId);

      if (!result.success) {
        failed.push({ row, reason: (result as any).message || 'Failed to create product' });
      } else if ((result as any).pendingApproval) {
        pendingApproval++;
      } else {
        created++;
      }
    } catch (error: any) {
      failed.push({ row, reason: error.message || 'Failed to create product' });
    }
  }

  return { created, pendingApproval, failed };
}
```

- [ ] **Step 3: Manual smoke test — verify end-to-end via a real call**

```ts
import { createProductsFromExcel } from '../app/(app)/products/bulk-price-update/actions';
import mysql from 'mysql2/promise';
(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'rootpassword', database: 'verdix' });
  const [wh]: any = await conn.query('SELECT id FROM warehouses LIMIT 1');
  const warehouseId = wh[0].id;
  const testSku = 'EXCEL-CREATE-TEST-' + Date.now();

  const result = await createProductsFromExcel(warehouseId, [
    { sku: testSku, barcode: '', name: 'Excel Created Product', brand: 'TestBrand', category: 'TestCategory', unitOfMeasure: 'pcs', price: 42 },
  ], 'system');
  console.log('createProductsFromExcel result:', result);

  const [rows]: any = await conn.query('SELECT id, name, sku, price, warehouse_id FROM products WHERE sku = ?', [testSku]);
  console.log('product row:', rows[0]);

  if (rows[0]) await conn.query('DELETE FROM products WHERE id = ?', [rows[0].id]);
  await conn.end();
})();
```
Expected: `result.created === 1` (assuming `require_product_confirmation` is off by default, matching this project's documented default), and the product row exists with `price: '42.00'` and the expected `warehouse_id`. Clean up the test row as shown.

*(If `require_product_confirmation` is on in your environment, expect `result.pendingApproval === 1` instead — either outcome confirms the wiring is correct; adjust the assertion to match your environment's actual setting.)*

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/products/bulk-price-update/actions.ts
git commit -m "feat: create products from classified Excel rows via addProduct"
```

---

### Task 3: Upload dialog UI — two-table preview and confirmation gate

**Files:**
- Modify: `app/(app)/products/bulk-price-update/use-upload-price-list.ts`
- Modify: `app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx`

**Interfaces:**
- Consumes: `createProductsFromExcel`, `CreateProductsResult`, `NewProductFromExcel` from Task 2; `previewPriceListUpload`'s `toCreate` field from Task 1.
- Produces: an "N new product(s) will be created" table with a gating confirmation checkbox; `submit()` now applies both `matched` and `toCreate` and reports a combined result.

- [ ] **Step 1: Update the hook**

Replace the full content of `app/(app)/products/bulk-price-update/use-upload-price-list.ts`:

```ts
'use client';

import { useState } from 'react';
import { parseFile } from '@/lib/import/parse-file';
import { previewPriceListUpload, submitPriceUpdateBatch, createProductsFromExcel, type PriceUpdateItem, type PriceListPreviewResult } from './actions';
import { mapParsedRowsToPriceListRows } from './price-list-template';
import { useToast } from '@/hooks/use-toast';

export function useUploadPriceList(warehouseId: string, onUpdated?: () => void) {
  const [preview, setPreview] = useState<PriceListPreviewResult | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setPreview(null);
    setConfirmCreate(false);
    try {
      const parsed = await parseFile(file);
      const rows = mapParsedRowsToPriceListRows(parsed);
      const result = await previewPriceListUpload(warehouseId, rows);
      setPreview(result);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed to read file', description: err.message || String(err) });
    } finally {
      setIsParsing(false);
    }
  };

  const submit = async (userId: string) => {
    if (!preview || (preview.matched.length === 0 && preview.toCreate.length === 0)) return null;
    if (preview.toCreate.length > 0 && !confirmCreate) return null;
    setIsSubmitting(true);
    try {
      const items: PriceUpdateItem[] = preview.matched;
      const updateResult = items.length > 0 ? await submitPriceUpdateBatch(warehouseId, items, userId) : null;
      const createResult = preview.toCreate.length > 0 ? await createProductsFromExcel(warehouseId, preview.toCreate, userId) : null;

      const parts: string[] = [];
      if (updateResult) parts.push(updateResult.pendingApproval ? `${items.length} update(s) submitted for approval` : `Updated ${updateResult.applied ?? 0} product(s)`);
      if (createResult) {
        if (createResult.created > 0) parts.push(`Created ${createResult.created} new product(s)`);
        if (createResult.pendingApproval > 0) parts.push(`${createResult.pendingApproval} new product(s) submitted for approval`);
        if (createResult.failed.length > 0) parts.push(`${createResult.failed.length} new product(s) failed`);
      }

      const anyFailure = (updateResult && !updateResult.success) || (createResult && createResult.failed.length > 0 && createResult.created === 0 && createResult.pendingApproval === 0);
      toast({
        variant: anyFailure ? 'destructive' : undefined,
        title: anyFailure ? 'Completed with issues' : 'Price list processed',
        description: parts.join('. ') || 'Nothing to do.',
      });
      setPreview(null);
      setConfirmCreate(false);
      onUpdated?.();
      return { updateResult, createResult };
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to submit price list.' });
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { preview, confirmCreate, setConfirmCreate, isParsing, isSubmitting, handleFile, submit, reset: () => { setPreview(null); setConfirmCreate(false); } };
}
```

- [ ] **Step 2: Update the dialog**

Replace the full content of `app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx`:

```tsx
'use client';

import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUploadPriceList } from './use-upload-price-list';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  onUpdated?: () => void;
}

function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('mock-user-session');
    return raw ? JSON.parse(raw).uid : 'system';
  } catch {
    return 'system';
  }
}

export function UploadPriceListDialog({ open, onOpenChange, warehouseId, onUpdated }: Props) {
  const up = useUploadPriceList(warehouseId, onUpdated);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasCreateRows = (up.preview?.toCreate.length ?? 0) > 0;
  const canSubmit = !!up.preview
    && (up.preview.matched.length > 0 || up.preview.toCreate.length > 0)
    && (!hasCreateRows || up.confirmCreate)
    && !up.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) up.reset(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Price List</DialogTitle>
          <DialogDescription>Upload a filled-in price list spreadsheet for this warehouse.</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="block w-full text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) up.handleFile(file);
          }}
        />

        {up.isParsing && <p className="text-sm text-muted-foreground">Reading file...</p>}

        {up.preview && (
          <div className="space-y-4">
            {up.preview.matched.length > 0 && (
              <div className="border rounded-lg max-h-56 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead className="text-right">Old</TableHead>
                      <TableHead className="text-right">New</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {up.preview.matched.map((item, i) => (
                      <TableRow key={`${item.productId}-${item.field}-${i}`}>
                        <TableCell>{item.productName}</TableCell>
                        <TableCell>{item.field}</TableCell>
                        <TableCell className="text-right">₱{item.oldValue.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">₱{item.newValue.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {hasCreateRows && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{up.preview.toCreate.length} new product(s) will be created</p>
                <div className="border rounded-lg max-h-56 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {up.preview.toCreate.map((row, i) => (
                        <TableRow key={`${row.sku}-${i}`}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>{row.sku}</TableCell>
                          <TableCell>{row.brand}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell className="text-right">₱{row.price.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="confirmCreate" checked={up.confirmCreate} onCheckedChange={(c) => up.setConfirmCreate(!!c)} />
                  <Label htmlFor="confirmCreate" className="text-sm font-normal">
                    I understand {up.preview.toCreate.length} new product(s) will be created
                  </Label>
                </div>
              </div>
            )}

            {up.preview.skipped.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{up.preview.skipped.length} row(s) skipped</summary>
                <ul className="mt-2 space-y-1 list-disc pl-5">
                  {up.preview.skipped.map((s, i) => (
                    <li key={i}>{s.row.sku || s.row.barcode || `Row ${i + 1}`}: {s.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={!canSubmit}
            onClick={() => up.submit(getCurrentUserId())}
          >
            {up.isSubmitting ? 'Submitting...' : `Submit ${(up.preview?.matched.length ?? 0) + (up.preview?.toCreate.length ?? 0)} Change(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no new errors in either file.

- [ ] **Step 4: Manual verification in the browser**

Run `npm run dev`, open the Bulk Update Price drawer, pick a warehouse, click "Download Template" (confirm it downloads exactly 3 rows with the 6 identity/reference columns populated), fill in a new row for a product that doesn't exist (`sku`, `name`, `brand`, `category`, `unit_of_measure`, `new_price`), click "Upload Excel", confirm:
1. The "N new product(s) will be created" table appears with the row's data.
2. The Submit button is disabled until the confirmation checkbox is checked.
3. After checking it and submitting, the toast reports the creation, and the new product appears in the Products list.

Also test the missing-fields case: a row with no matching product and a `new_price` but no `brand` — confirm it's skipped with a reason naming `brand` (and any other missing fields) rather than silently disappearing.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/products/bulk-price-update/use-upload-price-list.ts app/(app)/products/bulk-price-update/UploadPriceListDialog.tsx
git commit -m "feat: two-table upload preview with confirmation gate for new products"
```

---

### Task 4: E2E coverage

**Files:**
- Modify: `tests/e2e/bulk-price-update.spec.ts`
- Modify: `tests/e2e/fixtures/test-data.ts` (if a new fixture SKU constant is useful — optional, inline the SKU string directly in the test if simpler)

**Interfaces:**
- Consumes: the full feature built in Tasks 1-3.

- [ ] **Step 1: Add a test covering both classification paths in one upload**

In `tests/e2e/bulk-price-update.spec.ts`, add a new test inside the existing `test.describe('Bulk Price Update', ...)` block (following the same in-memory-XLSX-via-`xlsx`-package pattern the existing Excel test already uses — read that test first to match its exact `setInputFiles` approach):

```ts
  test('excel upload: creates a new product alongside an existing-product update', async ({ page, request }) => {
    await request.post('/api/pos-settings', { data: { requirePriceUpdateConfirmation: false } });

    await page.goto('/products');
    await page.getByRole('button', { name: 'Bulk Update Price' }).click();
    await page.getByText('Select a warehouse').click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: 'Upload Excel' }).click();

    const XLSX = require('xlsx');
    const newSku = 'E2E-NEW-PRODUCT-' + Date.now();
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['sku', 'barcode', 'name', 'brand', 'category', 'unit_of_measure', 'new_price', 'new_cost', 'new_markup_pct'],
      [BULK_PRICE_PRODUCT.sku, '', '', '', '', '', '999', '', ''],
      [newSku, '', 'E2E New Product', 'E2E Brand', 'E2E Category', 'pcs', '75', '', ''],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Price List');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await page.setInputFiles('input[type="file"][accept=".xlsx,.xls,.csv"]', {
      name: 'price-list.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buf,
    });

    await expect(page.getByText('1 new product(s) will be created')).toBeVisible();
    const submitButton = page.getByRole('button', { name: /Submit \d+ Change/ });
    await expect(submitButton).toBeDisabled();

    await page.getByRole('checkbox', { name: /I understand 1 new product/ }).check();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await expect(page.getByText(/processed/i)).toBeVisible();

    await expect(async () => {
      const res = await request.get(`/api/products?search=${newSku}`);
      const data = await res.json();
      expect(data.data?.[0]?.price).toBeCloseTo(75, 2);
    }).toPass({ timeout: 10_000 });

    // Cleanup: revert the update, remove the created product.
    await testQuery('UPDATE products SET price = ? WHERE id = ?', [/* capture priceBefore the same way the file's other tests do */]);
    await testQuery('DELETE FROM products WHERE sku = ?', [newSku]);
  });
```

Adapt the exact selector/helper names (`testQuery`, `BULK_PRICE_PRODUCT`, the `/api/products` search shape) to match whatever the existing tests in this file actually use — read the file's other three tests fully before writing this one, since this plan was written without re-verifying their exact current helper signatures after Task 11's earlier fix rounds. Capture `priceBefore` for `BULK_PRICE_PRODUCT` before the upload, matching the cleanup pattern the other tests already use.

- [ ] **Step 2: Run the scoped E2E spec (foreground, blocking, generous timeout)**

Run: `npx playwright test tests/e2e/bulk-price-update.spec.ts --reporter=list` (not backgrounded — see the documented lesson about subagents/background E2E runs stalling).
Expected: all tests in the file pass, including the new one.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/bulk-price-update.spec.ts
git commit -m "test: cover Excel-driven new-product creation in bulk price update e2e"
```

---

## Self-Review Notes

- **Spec coverage:** lean 3-row template + new columns (design's Template section) — Task 1 Steps 1-2; classification into `toCreate` with missing-field reasons (design's Classification section) — Task 1 Steps 3-4; creation via `addProduct`, no parallel path, approval-gate inherited (design's Creation path section) — Task 2; two-table preview + confirmation gate blocking submission (design's UI section) — Task 3; combined submit result reporting (design's Data Flow step 5) — Task 3 Step 1's `submit()`. Non-Goals (no Guided-Import-Wizard duplication beyond this scoped column set, no batched approval type, no fifth `description` column, no price-level support from to-create rows) are respected — nothing in any task adds those.
- **Type consistency:** `NewProductFromExcel` is defined once in Task 1 and imported unchanged by Task 2 (`createProductsFromExcel`'s parameter) and Task 3 (the preview table's row type, inferred from `PriceListPreviewResult.toCreate`). `CreateProductsResult` is defined once in Task 2 and consumed once in Task 3. `PriceListPreviewResult.toCreate` — defined in Task 1, populated in Task 1's own `previewPriceListUpload`, read in Task 3 — no redefinition anywhere.
- **Known follow-up, not blocking:** Task 4's Step 1 code block flags its own risk explicitly — the exact helper names in the existing E2E file may have drifted since this plan was written (that file went through its own fix rounds after this plan's research was done); the step instructs adapting to whatever's actually there rather than trusting the plan's snippet verbatim.
