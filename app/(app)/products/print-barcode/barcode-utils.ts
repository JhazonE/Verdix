import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';

import type { Product } from '@/lib/types';

export const LABEL_SIZES = [
  { label: '40 × 25 mm',  width: 40,  height: 25, fontSize: 6 },
  { label: '50 × 25 mm',  width: 50,  height: 25, fontSize: 6 },
  { label: '58 × 40 mm',  width: 58,  height: 40, fontSize: 7 },
  { label: '60 × 40 mm',  width: 60,  height: 40, fontSize: 7 },
  { label: '100 × 50 mm', width: 100, height: 50, fontSize: 8 },
];

export type LabelSize = (typeof LABEL_SIZES)[number];

export const PAPER_TYPES = [
  { label: 'Label Roll (exact size)', value: 'roll' as const },
  { label: 'A4 Sheet',                value: 'A4' as const },
  { label: 'Letter Sheet',            value: 'Letter' as const },
];

export type PaperType = (typeof PAPER_TYPES)[number]['value'];

export const SHEET_SIZES: Record<Exclude<PaperType, 'roll'>, { width: number; height: number }> = {
  A4:     { width: 210, height: 297 },
  Letter: { width: 216, height: 279 },
};

const SHEET_MARGIN_MM = 10;
const LABEL_GAP_MM = 2;

export const BARCODE_FORMATS = [
  { label: 'CODE128 (default)', value: 'CODE128' },
  { label: 'EAN-13',            value: 'EAN13'   },
  { label: 'EAN-8',             value: 'EAN8'    },
  { label: 'UPC-A',             value: 'UPC'     },
  { label: 'CODE39',            value: 'CODE39'  },
];

export function generateBarcodeDataUrl(value: string, format: string): string | null {
  const tryRender = (fmt: string): string => {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, value, {
      format: fmt,
      displayValue: true,
      fontSize: 14,
      height: 60,
      width: 2,
      margin: 10,
      textMargin: 4,
      font: 'monospace',
      background: '#ffffff',
      lineColor: '#000000',
    });
    return canvas.toDataURL('image/png');
  };
  try { return tryRender(format); }
  catch { try { return tryRender('CODE128'); } catch { return null; } }
}

function loadImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function computeGridLayout(
  paperType: PaperType,
  size: LabelSize,
): { cols: number; rows: number; perPage: number; usableWidth: number; usableHeight: number } {
  if (paperType === 'roll') {
    return { cols: 1, rows: 1, perPage: 1, usableWidth: size.width, usableHeight: size.height };
  }
  const sheet = SHEET_SIZES[paperType];
  const usableWidth  = sheet.width - SHEET_MARGIN_MM * 2;
  const usableHeight = sheet.height - SHEET_MARGIN_MM * 2;
  const cols = Math.max(1, Math.floor((usableWidth + LABEL_GAP_MM) / (size.width + LABEL_GAP_MM)));
  const rows = Math.max(1, Math.floor((usableHeight + LABEL_GAP_MM) / (size.height + LABEL_GAP_MM)));
  return { cols, rows, perPage: cols * rows, usableWidth, usableHeight };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface LabelItem {
  product: Product;
  qty: number;
  dataUrl: string;
  /** Selling unit this label is for; omitted for the base unit. */
  unitName?: string;
  /** This unit's own price; falls back to the product price. */
  price?: number;
}

export interface LabelUnit {
  key: string;
  name: string;
  isBase: boolean;
  /** Value encoded in the barcode. */
  value: string;
  price?: number;
}

const toNumber = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Every way a product is sold, each with the barcode it scans as. The base unit
 * falls back to the product barcode/SKU/id; other units only get a label when
 * they carry a barcode of their own.
 */
export function getLabelUnits(product: Product): LabelUnit[] {
  const units = product.sellingUnits ?? [];
  const base = units.find((u) => u.isBase);
  const list: LabelUnit[] = [{
    key: base?.id ?? 'base',
    name: base?.name ?? 'Base',
    isBase: true,
    value: base?.barcode || product.barcode || product.sku || product.id,
    price: toNumber(base?.price) ?? toNumber(product.price),
  }];
  for (const u of units) {
    if (u.isBase || !u.barcode) continue;
    list.push({
      key: u.id ?? `${u.name}:${u.barcode}`,
      name: u.name,
      isBase: false,
      value: u.barcode,
      price: toNumber(u.price),
    });
  }
  return list;
}

const itemName = (i: LabelItem) => (i.unitName ? `${i.product.name} (${i.unitName})` : i.product.name);
const itemPrice = (i: LabelItem) => i.price ?? toNumber(i.product.price);

export function buildPrintHTML(
  items: LabelItem[],
  size: LabelSize,
  showName: boolean,
  showPrice: boolean,
  paperType: PaperType = 'roll',
): string {
  const labelHtmlFor = (item: LabelItem) => {
    const price = itemPrice(item);
    const namePart  = showName
      ? `<div class="name">${escapeHtml(itemName(item))}</div>`
      : '';
    const pricePart = showPrice && price !== undefined
      ? `<div class="price">&#8369;${price.toFixed(2)}</div>`
      : '';

    // Inner .group holds the three elements tight together;
    // outer .label centers the group in the physical label area.
    return `
    <div class="label">
      <div class="group">
        ${namePart}
        <img class="barcode-img" src="${item.dataUrl}" alt="barcode" />
        ${pricePart}
      </div>
    </div>`;
  };

  const allLabelsHtml = items
    .flatMap((item) => Array.from({ length: item.qty }, () => labelHtmlFor(item)))
    .join('\n');

  const title = items.length === 1 ? items[0].product.name : `${items.length} products`;

  const pageCss = paperType === 'roll'
    ? `@page {
    size: ${size.width}mm ${size.height}mm;
    margin: 0;
  }
  .sheet { display: flex; flex-wrap: wrap; }`
    : (() => {
        const sheet = SHEET_SIZES[paperType];
        const usableWidth = sheet.width - SHEET_MARGIN_MM * 2;
        return `@page {
    size: ${paperType};
    margin: ${SHEET_MARGIN_MM}mm;
  }
  .sheet {
    display: flex;
    flex-wrap: wrap;
    gap: ${LABEL_GAP_MM}mm;
    width: ${usableWidth}mm;
  }`;
      })();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode - ${escapeHtml(title)}</title>
<style>
  ${pageCss}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #fff;
    font-family: monospace;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .label {
    width: ${size.width}mm;
    height: ${size.height}mm;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1mm;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  /* group shrinks to fit its content — name/barcode/price are tight */
  .group {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
  }
  .name {
    font-size: ${size.fontSize}pt;
    font-weight: bold;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    line-height: 1.2;
    margin-bottom: 0.4mm;
    flex: none;
  }
  /* barcode takes whatever height is left after name + price, so they never get clipped */
  .barcode-img {
    display: block;
    flex: 1 1 0;
    min-height: 0;
    width: 100%;
    object-fit: contain;
  }
  .price {
    font-size: ${size.fontSize + 1}pt;
    font-weight: bold;
    text-align: center;
    margin-top: 0.4mm;
    line-height: 1.2;
    flex: none;
  }
</style>
</head>
<body>
  <div class="sheet">
    ${allLabelsHtml}
  </div>
<script>
  window.onload = function () {
    window.print();
    setTimeout(function () { window.close(); }, 600);
  };
</script>
</body>
</html>`;
}

const MM_PER_PT = 25.4 / 72;

export async function buildPrintPDF(
  items: LabelItem[],
  size: LabelSize,
  showName: boolean,
  showPrice: boolean,
  paperType: PaperType = 'roll',
): Promise<jsPDF> {
  // Distinct data URLs only need their aspect ratio loaded once.
  const aspectByUrl = new Map<string, number>();
  for (const { dataUrl } of items) {
    if (aspectByUrl.has(dataUrl)) continue;
    const imgSize = await loadImageSize(dataUrl);
    aspectByUrl.set(dataUrl, imgSize.width / imgSize.height);
  }

  const labels = items.flatMap((item) => Array.from({ length: item.qty }, () => item));

  const { cols, perPage } = computeGridLayout(paperType, size);
  const format: [number, number] =
    paperType === 'roll' ? [size.width, size.height] : [SHEET_SIZES[paperType].width, SHEET_SIZES[paperType].height];

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format });

  const nameFontPt  = size.fontSize;
  const priceFontPt = size.fontSize + 1;

  const originX = paperType === 'roll' ? 0 : SHEET_MARGIN_MM;
  const originY = paperType === 'roll' ? 0 : SHEET_MARGIN_MM;
  const cellW = paperType === 'roll' ? size.width : size.width + LABEL_GAP_MM;
  const cellH = paperType === 'roll' ? size.height : size.height + LABEL_GAP_MM;

  for (let i = 0; i < labels.length; i++) {
    const posInPage = i % perPage;
    if (i > 0 && posInPage === 0) doc.addPage(format, 'portrait');

    const { dataUrl } = labels[i];
    const price = itemPrice(labels[i]);
    const imgAspect = aspectByUrl.get(dataUrl)!;
    const nameHeightMm  = showName ? nameFontPt * MM_PER_PT * 1.3 : 0;
    const priceHeightMm = showPrice && price !== undefined ? priceFontPt * MM_PER_PT * 1.3 : 0;
    const priceText = price !== undefined ? `₱${price.toFixed(2)}` : '';

    const col = posInPage % cols;
    const row = Math.floor(posInPage / cols);
    const cellX = originX + col * cellW;
    const cellY = originY + row * cellH;

    const barcodeAreaH = size.height - nameHeightMm - priceHeightMm - 2;
    let barcodeW = size.width - 2;
    let barcodeH = barcodeW / imgAspect;
    if (barcodeH > barcodeAreaH) {
      barcodeH = barcodeAreaH;
      barcodeW = barcodeH * imgAspect;
    }
    const barcodeX = cellX + (size.width - barcodeW) / 2;
    let cursorY = cellY + 1;

    if (showName) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(nameFontPt);
      const truncated = doc.splitTextToSize(itemName(labels[i]),size.width - 2)[0] as string;
      doc.text(truncated, cellX + size.width / 2, cursorY + nameHeightMm * 0.7, { align: 'center' });
      cursorY += nameHeightMm;
    }

    doc.addImage(dataUrl, 'PNG', barcodeX, cursorY, barcodeW, barcodeH);
    cursorY += barcodeH;

    if (priceText) {
      doc.setFont('courier', 'bold');
      doc.setFontSize(priceFontPt);
      doc.text(priceText, cellX + size.width / 2, cursorY + priceHeightMm * 0.7, { align: 'center' });
    }
  }

  return doc;
}
