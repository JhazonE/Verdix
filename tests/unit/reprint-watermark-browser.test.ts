import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReceiptView } from '../../app/(app)/pos/receipt/ReceiptView';
import { ZReadingPreview } from '../../app/(app)/sales/z-reading/z-reading-preview';
import type { ZReadingData } from '../../lib/types';

// The browser (react-to-print) rendering path must show the same REPRINT
// watermark as the ESC/POS path (Tasks 1-2), since `printMode` defaults to
// 'browser' when unset in settings and every reprint must satisfy BIR Annex
// F checklist items #12 and #15 regardless of which print path is active.

const baseSaleDetails = {
  items: [{ name: 'Rice', price: 100, quantity: 1, discount: 0, taxType: 'VAT' } as any],
  customer: null,
  totalDue: 100,
  change: 0,
  paymentMethod: 'CASH',
};

// ─── ReceiptView (sale receipt) ──────────────────────────────────────────
const originalHtml = renderToStaticMarkup(
  React.createElement(ReceiptView, { saleDetails: baseSaleDetails, settings: null }),
);
assert.ok(!originalHtml.includes('REPRINT'), 'original browser-printed receipt has no REPRINT watermark');

const reprintHtml = renderToStaticMarkup(
  React.createElement(ReceiptView, {
    saleDetails: { ...baseSaleDetails, isReprint: true },
    settings: null,
  }),
);
assert.ok(reprintHtml.includes('REPRINT'), 'reprinted browser receipt shows REPRINT watermark');
assert.ok(reprintHtml.includes('Reprinted:'), 'reprinted browser receipt shows a reprint timestamp label');

console.log('✓ reprint-watermark-browser (ReceiptView)');

// ─── ZReadingPreview (Z-reading) ─────────────────────────────────────────
const baseZData: ZReadingData = {
  id: 'PREVIEW',
  date: '2026-08-10',
  reportDate: new Date('2026-08-10T18:00:00'),
  grossSales: 1000,
  returns: 0,
  discounts: 0,
  netSales: 1000,
  vatSales: 892.86,
  vatAmount: 107.14,
  vatExempt: 0,
  zeroRated: 0,
  nonVat: 0,
  paymentMethods: [{ name: 'CASH', amount: 1000 }],
  transactionCount: 1,
  startingCash: 0,
  cashSales: 1000,
  cashInDrawer: 1000,
};

const freshZHtml = renderToStaticMarkup(
  React.createElement(ZReadingPreview, { data: baseZData, printerFormat: '58mm', businessSettings: null }),
);
assert.ok(!freshZHtml.includes('REPRINT'), 'fresh Z-reading preview (id=PREVIEW) has no REPRINT watermark');

const reprintZHtml = renderToStaticMarkup(
  React.createElement(ZReadingPreview, {
    data: { ...baseZData, id: 'z-2026-08-09-001' },
    printerFormat: '58mm',
    businessSettings: null,
  }),
);
assert.ok(reprintZHtml.includes('REPRINT'), 'historical Z-reading preview (id!=PREVIEW) shows REPRINT watermark');
assert.ok(reprintZHtml.includes('Reprinted:'), 'historical Z-reading preview shows a reprint timestamp label');

console.log('✓ reprint-watermark-browser (ZReadingPreview)');
