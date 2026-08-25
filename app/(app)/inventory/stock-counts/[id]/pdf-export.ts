import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toSafeNumber } from '@/lib/utils';

/**
 * Exports every item in a stock count to a paginated PDF, independent of the
 * on-screen search/pagination. Browser print (see print-layout.tsx) is deliberately
 * capped to one page of items at a time — `position: fixed` print CSS overlaps
 * across page breaks once content exceeds one printed page, and a whole-store count
 * can run to thousands of rows. jsPDF/autoTable paginate programmatically instead of
 * relying on the browser's print engine, so a full multi-thousand-row export is safe.
 */
export function exportStockCountToPDF(count: any, items: any[]) {
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(18);
  doc.text('STOCK COUNT REPORT', 14, 18);
  doc.setFontSize(12);
  doc.text(count.name || '', 14, 26);

  doc.setFontSize(9);
  const infoLines = [
    `Status: ${String(count.status || '').replace('_', ' ').toUpperCase()}`,
    `Created Date: ${count.created_at ? new Date(count.created_at).toLocaleDateString() : '-'}`,
    `Created By: ${count.created_by || '-'}`,
  ];
  infoLines.forEach((line, i) => doc.text(line, 14, 33 + i * 5));

  let totalVariance = 0;
  let totalVarianceAmount = 0;

  const body = items.map((item) => {
    const variance =
      item.counted_quantity !== null ? item.counted_quantity - item.snapshot_quantity : null;
    const actualQty = toSafeNumber(item.counted_quantity);
    const costAmount = actualQty * toSafeNumber(item.product_cost);
    const retailAmount = actualQty * toSafeNumber(item.product_retail);
    const varianceAmount = variance === null ? null : variance * toSafeNumber(item.product_cost);

    if (variance !== null) {
      totalVariance += variance;
      totalVarianceAmount += varianceAmount as number;
    }

    return [
      item.product_name || '',
      item.product_barcode || '-',
      item.snapshot_quantity ?? 0,
      item.counted_quantity !== null ? item.counted_quantity : '',
      `P${costAmount.toFixed(2)}`,
      `P${retailAmount.toFixed(2)}`,
      variance === null ? '-' : variance > 0 ? `+${variance}` : String(variance),
      varianceAmount === null ? '-' : `P${varianceAmount.toFixed(2)}`,
    ];
  });

  autoTable(doc, {
    startY: 48,
    head: [[
      'Product Name', 'Barcode', 'Expected', 'Actual Count',
      'Cost Amount', 'Retail Amount', 'Variance', 'Variance Amount',
    ]],
    body,
    foot: [[
      { content: 'Totals', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: totalVariance > 0 ? `+${totalVariance}` : String(totalVariance), styles: { fontStyle: 'bold' } },
      { content: `P${totalVarianceAmount.toFixed(2)}`, styles: { fontStyle: 'bold' } },
    ]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 30, 30] },
    showHead: 'everyPage',
    showFoot: 'lastPage',
    didDrawPage: (data) => {
      const pageSize = doc.internal.pageSize;
      doc.setFontSize(8);
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageSize.width - 20,
        pageSize.height - 8
      );
    },
  });

  const safeName = (count.name || 'stock-count').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`${safeName}-full-report.pdf`);
}
