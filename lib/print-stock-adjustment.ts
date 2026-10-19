import { format } from 'date-fns';

import { getApiUrl } from '@/lib/api-config';

// Same contract as escapeReportHtml in lib/report-print.ts, inlined so this
// slip does not drag jsPDF into the bulk-adjustment bundle for six lines.
// Product names and notes are user input and land inside this markup.
const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export type AdjustmentSlipMode = 'add' | 'remove' | 'transfer';

export interface AdjustmentSlipItem {
  productName: string;
  barcode?: string | null;
  unitOfMeasure?: string | null;
  quantity: number;
  previousStock: number;
  reason?: string | null;
  expirationDate?: string | null;
  /** Items held in the approval queue have not moved any stock yet. */
  pendingApproval?: boolean;
}

export interface AdjustmentSlipData {
  mode: AdjustmentSlipMode;
  referenceNo?: string | null;
  warehouseName?: string | null;
  targetWarehouseName?: string | null;
  supplierName?: string | null;
  preparedBy?: string | null;
  notes?: string | null;
  /**
   * When the transaction happened. Omitted for a slip printed at the moment of
   * the adjustment; set on a reprint so the slip is dated by the transaction,
   * not by the day someone happened to reprint it.
   */
  transactionDate?: string | Date | null;
  /** Marks the document as a reprint so it cannot pass as the original. */
  isReprint?: boolean;
  /**
   * Transfers never recorded the source stock at the time, so printing a
   * previous/new figure would be a guess. Drops both columns instead.
   */
  omitStockColumns?: boolean;
  items: AdjustmentSlipItem[];
}

const modeConfig: Record<AdjustmentSlipMode, { title: string; color: string; verb: string }> = {
  add: { title: 'STOCK ADDITION SLIP', color: '#047857', verb: 'Added' },
  remove: { title: 'STOCK REMOVAL SLIP', color: '#b91c1c', verb: 'Removed' },
  transfer: { title: 'STOCK TRANSFER SLIP', color: '#1d4ed8', verb: 'Transferred' },
};

// The header should name the actual business, not a hardcoded brand. Mirrors
// lib/print-payment-receipt.ts — settings are the single source for this.
const fetchBusinessName = async (): Promise<string> => {
  try {
    const res = await fetch(getApiUrl('/pos-settings'));
    if (!res.ok) return 'BUSINESS NAME';
    const settings = await res.json();
    return settings?.data?.businessName?.trim() || 'BUSINESS NAME';
  } catch {
    return 'BUSINESS NAME';
  }
};

/**
 * Opens a print window with a one-page A4 slip for a bulk stock adjustment
 * batch — one slip per transaction, not per item — ending in Prepared By and
 * Received By signature lines.
 *
 * Items still sitting in the approval queue are marked PENDING: their stock has
 * not moved, and a slip that showed them as applied would be a false record.
 */
export const printStockAdjustment = async (data: AdjustmentSlipData): Promise<boolean> => {
  // Open synchronously inside the click handler or popup blockers eat it.
  const printWindow = window.open('', '', 'height=800,width=900');
  // Report the block so the caller can tell the user, rather than redirecting
  // away as if the slip had printed.
  if (!printWindow) return false;

  printWindow.document.write(
    '<html><head><title>Stock Adjustment Slip</title></head>' +
      '<body style="font-family: sans-serif; padding: 40px;">Preparing slip…</body></html>'
  );

  const businessName = await fetchBusinessName();
  const config = modeConfig[data.mode];
  const now = new Date();
  // A reprint is dated by the transaction it reproduces; a fresh slip by now.
  const txDate = data.transactionDate ? new Date(data.transactionDate) : now;
  const showStock = !data.omitStockColumns;
  const isTransfer = data.mode === 'transfer';
  const showExpiry = data.mode === 'add' && data.items.some(i => i.expirationDate);
  const hasPending = data.items.some(i => i.pendingApproval);
  const allPending = data.items.length > 0 && data.items.every(i => i.pendingApproval);

  const totalQty = data.items.reduce((sum, i) => sum + Math.abs(Number(i.quantity) || 0), 0);

  // "New stock" is only meaningful for an item that actually moved. A removal
  // and a transfer both take stock off the source side.
  const signedDelta = (qty: number) => (data.mode === 'add' ? Math.abs(qty) : -Math.abs(qty));

  const infoRow = (label: string, value: string) => `
    <div class="info-item">
      <span class="info-label">${escapeHtml(label)}</span>
      <span class="info-value">${escapeHtml(value)}</span>
    </div>`;

  const columnCount = 4 + (showStock ? 2 : 0) + (showExpiry ? 1 : 0);

  const rows = data.items
    .map(item => {
      const qty = Math.abs(Number(item.quantity) || 0);
      const prev = Number(item.previousStock) || 0;
      const next = prev + signedDelta(qty);
      return `
      <tr${item.pendingApproval ? ' class="pending-row"' : ''}>
        <td>
          <div class="product-name">${escapeHtml(item.productName)}</div>
          ${item.barcode ? `<div class="product-meta">${escapeHtml(item.barcode)}</div>` : ''}
          ${item.pendingApproval ? '<span class="badge badge-pending">Pending Approval</span>' : ''}
        </td>
        <td class="ctr">${escapeHtml(item.unitOfMeasure || '-')}</td>
        <td class="ctr qty">${qty.toLocaleString('en-US')}</td>
        ${showStock ? `
        <td class="ctr">${prev.toLocaleString('en-US')}</td>
        <td class="ctr">${item.pendingApproval ? '<span class="muted">—</span>' : next.toLocaleString('en-US')}</td>` : ''}
        ${showExpiry ? `<td class="ctr">${item.expirationDate ? escapeHtml(format(new Date(item.expirationDate), 'MMM dd, yyyy')) : '-'}</td>` : ''}
        <td>${escapeHtml(item.reason || '-')}</td>
      </tr>`;
    })
    .join('');

  printWindow.document.open();
  printWindow.document.write(`<html><head><title>${escapeHtml(config.title)}${data.referenceNo ? ' - ' + escapeHtml(data.referenceNo) : ''}</title>`);
  printWindow.document.write('<style>');
  printWindow.document.write(`
    @page { size: A4; margin: 14mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; padding: 0; color: #111827; line-height: 1.5; }

    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 20px; }
    .company-info h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
    .company-info p { margin: 4px 0 0; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
    .slip-title { text-align: right; }
    .slip-title h2 { margin: 0; font-size: 18px; color: ${config.color}; letter-spacing: 0.02em; }
    .slip-title p { margin: 4px 0 0; font-size: 13px; font-weight: 700; font-family: monospace; }
    /* A reprint must be visibly a reprint: two copies of one transaction in a
       folder are otherwise indistinguishable. */
    .reprint-mark { display: inline-block; margin-top: 6px !important; padding: 2px 8px; border: 1px solid #9ca3af; border-radius: 4px; font-size: 9px !important; letter-spacing: 0.1em; color: #4b5563; font-family: inherit !important; }

    .pending-banner { border: 1px solid #fcd34d; background: #fffbeb; color: #92400e; padding: 10px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 18px; }

    .info-section { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
    .info-box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
    .info-item { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 3px 0; }
    .info-label { font-weight: 600; color: #4b5563; white-space: nowrap; }
    .info-value { text-align: right; }

    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .items-table th { background: #f3f4f6; text-align: left; padding: 9px 8px; border: 1px solid #e5e7eb; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #4b5563; }
    .items-table td { padding: 9px 8px; border: 1px solid #e5e7eb; font-size: 11px; vertical-align: top; }
    .items-table tfoot td { background: #f9fafb; font-weight: 700; font-size: 11px; }
    .ctr { text-align: center; }
    .qty { font-weight: 700; color: ${config.color}; }
    .muted { color: #9ca3af; }
    .product-name { font-weight: 600; }
    .product-meta { font-size: 9px; color: #6b7280; font-family: monospace; margin-top: 2px; }
    .pending-row { background: #fffbeb; }
    .badge { display: inline-block; margin-top: 4px; padding: 1px 6px; border-radius: 9999px; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-pending { background: #fef3c7; color: #92400e; }

    .notes-section { margin-top: 18px; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
    .notes-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #4b5563; margin-bottom: 6px; }
    .notes-content { font-size: 12px; white-space: pre-wrap; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 56px; page-break-inside: avoid; }
    .signature-block { text-align: center; }
    /* Printed name sits just above the rule, leaving clear space to sign over. */
    .signature-name { font-size: 12px; font-weight: 600; min-height: 18px; margin-bottom: 34px; }
    .signature-rule { border-top: 1px solid #6b7280; padding-top: 6px; }
    .signature-role { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #374151; }
    .signature-hint { font-size: 9px; color: #9ca3af; margin-top: 2px; }

    .footer { margin-top: 44px; border-top: 1px solid #f3f4f6; padding-top: 14px; text-align: center; font-size: 9px; color: #9ca3af; }

    @media print { body { padding: 0; } .pending-row { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `);
  printWindow.document.write('</style></head><body>');

  printWindow.document.write(`
    <div class="header">
      <div class="company-info">
        <h1>${escapeHtml(businessName)}</h1>
        <p>Inventory Control</p>
      </div>
      <div class="slip-title">
        <h2>${escapeHtml(config.title)}${allPending ? ' — FOR APPROVAL' : ''}</h2>
        <p>${escapeHtml(data.referenceNo || format(txDate, 'yyyyMMdd-HHmmss'))}</p>
        ${data.isReprint ? '<p class="reprint-mark">REPRINT</p>' : ''}
      </div>
    </div>

    ${hasPending ? `
      <div class="pending-banner">
        <strong>${allPending ? 'No stock has moved yet.' : 'Some items have not moved yet.'}</strong>
        Rows marked <em>Pending Approval</em> are waiting in the approval queue — their stock changes apply only once approved.
      </div>` : ''}

    <div class="info-section">
      <div class="info-box">
        ${infoRow('Date', format(txDate, 'MMMM dd, yyyy'))}
        ${infoRow('Time', format(txDate, 'h:mm a'))}
        ${infoRow('Reference No.', data.referenceNo || 'Not specified')}
        ${infoRow('Transaction', config.title.replace(' SLIP', ''))}
      </div>
      <div class="info-box">
        ${isTransfer
          ? infoRow('From Warehouse', data.warehouseName || 'Not specified') +
            infoRow('To Warehouse', data.targetWarehouseName || 'Not specified')
          : infoRow('Warehouse', data.warehouseName || 'All warehouses')}
        ${infoRow('Supplier', data.supplierName || 'None / External')}
        ${infoRow('Total Items', `${data.items.length}`)}
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 30%;">Product</th>
          <th class="ctr">Unit</th>
          <th class="ctr">Qty ${escapeHtml(config.verb)}</th>
          ${showStock ? '<th class="ctr">Prev. Stock</th><th class="ctr">New Stock</th>' : ''}
          ${showExpiry ? '<th class="ctr">Expiry</th>' : ''}
          <th>Reason / Note</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">TOTAL</td>
          <td class="ctr">${totalQty.toLocaleString('en-US')}</td>
          <td colspan="${columnCount - 3}"></td>
        </tr>
      </tfoot>
    </table>

    ${data.notes ? `
      <div class="notes-section">
        <div class="notes-title">Notes</div>
        <div class="notes-content">${escapeHtml(data.notes)}</div>
      </div>` : ''}

    <div class="signatures">
      <div class="signature-block">
        <div class="signature-name">${escapeHtml(data.preparedBy || '')}</div>
        <div class="signature-rule">
          <div class="signature-role">Prepared By</div>
          <div class="signature-hint">Name over Signature / Date</div>
        </div>
      </div>
      <div class="signature-block">
        <div class="signature-name">&nbsp;</div>
        <div class="signature-rule">
          <div class="signature-role">Received By</div>
          <div class="signature-hint">Name over Signature / Date</div>
        </div>
      </div>
    </div>

    <div class="footer">
      ${escapeHtml(businessName)} · Printed ${escapeHtml(format(now, 'MMMM dd, yyyy h:mm a'))}${
        data.isReprint
          ? ' · Reprint of a transaction dated ' + escapeHtml(format(txDate, 'MMMM dd, yyyy h:mm a'))
          : ''
      } · This is a computer-generated document.
    </div>
  `);

  printWindow.document.write('</body></html>');
  printWindow.document.close();

  setTimeout(() => printWindow.print(), 500);
  return true;
};
