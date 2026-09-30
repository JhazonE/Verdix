'use client';

import { useMemo, useState } from 'react';

import type { Product } from '@/lib/types';

import type { LabelItem, PaperType } from './barcode-utils';
import { LABEL_SIZES, buildPrintHTML, buildPrintPDF, generateBarcodeDataUrl, getLabelUnits } from './barcode-utils';

export interface UsePrintBarcodeProps {
  product: Product;
}

/**
 * Controller for the print barcode dialog: owns the label options, derives the
 * barcode image for each selling unit, and builds + opens the print window.
 */
export function usePrintBarcode({ product }: UsePrintBarcodeProps) {
  const units = useMemo(() => getLabelUnits(product), [product]);

  // Labels to print per selling unit (0 = skip). Only the base unit starts on.
  const [qtyByUnit, setQtyByUnit] = useState<Record<string, number>>(
    () => ({ [units[0].key]: 1 }),
  );
  const [sizeIndex, setSizeIndex] = useState(0);
  const [format, setFormat]       = useState('EAN8');
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName]   = useState(true);
  const [paperType, setPaperType] = useState<PaperType>('roll');

  const size         = LABEL_SIZES[sizeIndex];
  const barcodeValue = units[0].value;

  const setUnitQty = (key: string, value: number) =>
    setQtyByUnit((prev) => ({ ...prev, [key]: Math.max(0, Math.min(500, value || 0)) }));

  const unitDataUrls = useMemo(
    () => Object.fromEntries(
      units.map((u) => [u.key, u.value ? generateBarcodeDataUrl(u.value, format) : null]),
    ) as Record<string, string | null>,
    [units, format],
  );

  const items: LabelItem[] = units.flatMap((u) => {
    const qty = qtyByUnit[u.key] ?? 0;
    const dataUrl = unitDataUrls[u.key];
    if (qty < 1 || !dataUrl) return [];
    return [{ product, qty, dataUrl, unitName: u.isBase ? undefined : u.name, price: u.price }];
  });

  const totalLabels = items.reduce((sum, i) => sum + i.qty, 0);

  // The preview shows the first unit that will actually print.
  const previewItem = items[0] ?? null;
  const previewProduct: Product = previewItem
    ? {
        ...product,
        name: previewItem.unitName ? `${product.name} (${previewItem.unitName})` : product.name,
        price: previewItem.price ?? product.price,
      }
    : product;
  const dataUrl = previewItem?.dataUrl ?? unitDataUrls[units[0].key];

  const handlePrint = () => {
    if (items.length === 0) return;
    const html = buildPrintHTML(items, size, showName, showPrice, paperType);
    const win = window.open('', '_blank', 'width=500,height=400,left=200,top=100');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups for this site to print barcodes.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  const handleExportPDF = async () => {
    if (items.length === 0) return;
    const doc = await buildPrintPDF(items, size, showName, showPrice, paperType);
    doc.save(`Barcode-${product.name}.pdf`);
  };

  return {
    units,
    qtyByUnit,
    setUnitQty,
    unitDataUrls,
    totalLabels,
    sizeIndex,
    setSizeIndex,
    format,
    setFormat,
    showPrice,
    setShowPrice,
    showName,
    setShowName,
    paperType,
    setPaperType,
    size,
    barcodeValue,
    dataUrl,
    previewProduct,
    handlePrint,
    handleExportPDF,
  };
}
