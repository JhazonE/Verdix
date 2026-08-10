import { format } from 'date-fns';
import jsPDF from 'jspdf';

// Escape user-provided text before injecting into the print document.
export function escapeReportHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type ReportAlign = 'left' | 'right' | 'center';

export interface ReportPrintColumn<T> {
  header: string;
  align?: ReportAlign;
  /** Return the already-formatted cell text (use the same formatters as the on-screen table). */
  cell: (row: T, index: number) => string | number;
  /** Emphasize the cell (bold) — e.g. totals-relevant numeric columns. */
  emphasize?: boolean;
}

export interface ReportPrintBusiness {
  businessName?: string | null;
  address?: string | null;
  contactNumber?: string | null;
  tin?: string | null;
}

export interface ReportSummaryItem {
  label: string;
  value: string;
}

export interface PrintReportOptions<T> {
  title: string;
  subtitle?: string;
  period?: string;
  business?: ReportPrintBusiness;
  columns: ReportPrintColumn<T>[];
  rows: T[];
  /** Totals row, aligned 1:1 to `columns`. Use null for cells with no total. */
  totals?: (string | number | null)[];
  /** Summary key/value pairs shown above the table. */
  summary?: ReportSummaryItem[];
  /** Show the signature + footer block. */
  showSignature?: boolean;
  emptyMessage?: string;
}

/**
 * Opens a print window with a consistent, professional report layout and triggers print.
 * Prints the FULL `rows` passed in (callers should fetch the complete dataset first so the
 * printout matches the generated on-screen report rather than the current paginated page).
 */
export function printReportTable<T>(opts: PrintReportOptions<T>): void {
  const {
    title,
    subtitle,
    period,
    business,
    columns,
    rows,
    totals,
    summary,
    showSignature = false,
    emptyMessage = 'No records found.',
  } = opts;

  const colCount = columns.length;

  const headCells = columns
    .map((c) => `<th class="${c.align === 'right' ? 'num' : c.align === 'center' ? 'ctr' : ''}">${escapeReportHtml(c.header)}</th>`)
    .join('');

  const bodyRows = rows.length > 0
    ? rows
        .map((row, rowIndex) => {
          const cells = columns
            .map((c) => {
              const cls = [c.align === 'right' ? 'num' : c.align === 'center' ? 'ctr' : '', c.emphasize ? 'emph' : '']
                .filter(Boolean)
                .join(' ');
              return `<td class="${cls}">${escapeReportHtml(c.cell(row, rowIndex))}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${colCount}" class="empty">${escapeReportHtml(emptyMessage)}</td></tr>`;

  const totalsRow = totals && rows.length > 0
    ? `<tr class="totals">${columns
        .map((c, i) => {
          const val = totals[i];
          const cls = c.align === 'right' ? 'num' : c.align === 'center' ? 'ctr' : '';
          return `<td class="${cls}">${val == null ? '' : escapeReportHtml(val)}</td>`;
        })
        .join('')}</tr>`
    : '';

  const summaryBlock = summary && summary.length > 0
    ? `<div class="summary">${summary
        .map((s) => `<div class="summary-item"><span class="summary-label">${escapeReportHtml(s.label)}</span><span class="summary-value">${escapeReportHtml(s.value)}</span></div>`)
        .join('')}</div>`
    : '';

  const bizName = escapeReportHtml(business?.businessName || 'Vendix');
  const bizMeta = [
    business?.address ? escapeReportHtml(business.address) : '',
    business?.contactNumber ? `Tel: ${escapeReportHtml(business.contactNumber)}` : '',
    business?.tin ? `TIN: ${escapeReportHtml(business.tin)}` : '',
  ].filter(Boolean);

  const signatureBlock = showSignature
    ? `<div class="footer">
         <div>Authorized Signature: ___________________________</div>
         <div class="footer-right">
           <div>Generated: ${escapeReportHtml(format(new Date(), 'PPpp'))}</div>
           <div class="powered">Powered by Vendix</div>
         </div>
       </div>`
    : `<p class="meta">Generated: ${escapeReportHtml(format(new Date(), 'PPpp'))} &middot; ${rows.length} record(s)</p>`;

  const html = `<!DOCTYPE html><html><head><title>${escapeReportHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 24px; }
      .biz { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 16px; }
      .biz-name { font-size: 22px; font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em; margin: 0; }
      .biz-meta { color: #666; font-size: 11px; margin-top: 4px; display: flex; gap: 12px; }
      .biz-date { text-align: right; font-size: 12px; color: #444; }
      h1 { font-size: 20px; margin: 0 0 2px; }
      .sub { color: #666; font-size: 12px; margin: 0 0 4px; }
      .period { color: #444; font-size: 11px; font-weight: 600; margin: 0 0 16px; }
      .summary { display: flex; flex-wrap: wrap; gap: 24px; margin: 12px 0 16px; padding: 12px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
      .summary-item { display: flex; flex-direction: column; }
      .summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
      .summary-value { font-size: 16px; font-weight: 800; color: #0f172a; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border-bottom: 1px solid #ddd; padding: 7px 9px; text-align: left; }
      th { background: #f5f5f5; font-weight: bold; text-transform: uppercase; font-size: 9px; letter-spacing: .05em; }
      th.num, td.num { text-align: right; }
      th.ctr, td.ctr { text-align: center; }
      td.emph { font-weight: 700; }
      td.empty { text-align: center; padding: 24px; color: #64748b; }
      tr.totals td { border-top: 2px solid #94a3b8; border-bottom: none; font-weight: 800; background: #f1f5f9; font-size: 11px; }
      .meta { color: #888; font-size: 10px; margin-top: 16px; }
      .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; }
      .footer-right { text-align: right; }
      .powered { margin-top: 4px; font-weight: 700; color: #94a3b8; }
      @page { margin: 1cm; }
    </style></head>
    <body>
      <div class="biz">
        <div>
          <p class="biz-name">${bizName}</p>
          ${bizMeta.length ? `<div class="biz-meta">${bizMeta.map((m) => `<span>${m}</span>`).join('')}</div>` : ''}
        </div>
        <div class="biz-date">
          <div>${escapeReportHtml(format(new Date(), 'MMMM dd, yyyy'))}</div>
          <div>${escapeReportHtml(format(new Date(), 'hh:mm aa'))}</div>
        </div>
      </div>
      <h1>${escapeReportHtml(title)}</h1>
      ${subtitle ? `<p class="sub">${escapeReportHtml(subtitle)}</p>` : ''}
      ${period ? `<p class="period">Period: ${escapeReportHtml(period)}</p>` : ''}
      ${summaryBlock}
      <table>
        <thead><tr>${headCells}</tr></thead>
        <tbody>${bodyRows}${totalsRow}</tbody>
      </table>
      ${signatureBlock}
    </body></html>`;

  const printWindow = window.open('', '_blank', 'width=1000,height=700');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
  setTimeout(() => { try { printWindow.print(); } catch { /* noop */ } }, 300);
}

// ---------------------------------------------------------------------------
// Shared jsPDF export — keeps every "Export to PDF" report visually consistent
// and column-aligned with its on-screen table.
// ---------------------------------------------------------------------------

export interface PdfReportColumn<T> {
  header: string;
  /** Column width in mm. */
  width: number;
  align?: 'left' | 'right';
  /** Return already-formatted cell text (use the same formatters as the table). */
  cell: (row: T, index: number) => string;
}

export interface PdfReportOptions<T> {
  title: string;
  dateRange?: string;
  /** Summary key/value pairs rendered above the table (3 per row). */
  summary?: ReportSummaryItem[];
  columns: PdfReportColumn<T>[];
  rows: T[];
  /** Totals row aligned 1:1 to `columns`. Use null for cells with no total. */
  totals?: (string | null)[];
  fileName: string;
  orientation?: 'landscape' | 'portrait';
}

/**
 * Generates a consistent landscape/portrait PDF from column definitions and rows.
 * Returns false if there are no rows to export (caller can toast a "No Data" message).
 */
export function exportReportPdf<T>(opts: PdfReportOptions<T>): boolean {
  const { title, dateRange, summary, columns, rows, totals, fileName, orientation = 'landscape' } = opts;
  if (rows.length === 0) return false;

  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const tableWidth = columns.reduce((sum, c) => sum + c.width, 0);
  let yPos = margin;

  // Title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, pageWidth / 2, yPos, { align: 'center' });
  yPos += 8;

  // Date range
  if (dateRange) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(dateRange, pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;
  } else {
    yPos += 2;
  }

  // Summary (3 per row)
  if (summary && summary.length > 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    summary.forEach((item, i) => {
      const col = i % 3;
      if (col === 0 && i > 0) yPos += 6;
      doc.text(`${item.label}: ${item.value}`, margin + col * 95, yPos);
    });
    yPos += 10;
  }

  const drawHeader = () => {
    doc.setFillColor(34, 197, 94);
    doc.rect(margin, yPos - 4, tableWidth, 8, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    let xPos = margin;
    columns.forEach((c) => {
      const tx = c.align === 'right' ? xPos + c.width - 1 : xPos + 1;
      doc.text(c.header, tx, yPos, { maxWidth: c.width - 2, align: c.align === 'right' ? 'right' : 'left' });
      xPos += c.width;
    });
    yPos += 6;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
  };

  drawHeader();

  rows.forEach((row, rowIndex) => {
    if (yPos > pageHeight - 20) {
      doc.addPage();
      yPos = margin;
      drawHeader();
    }

    if (rowIndex % 2 === 0) {
      doc.setFillColor(245, 245, 245);
      doc.rect(margin, yPos - 3, tableWidth, 6, 'F');
    }

    let xPos = margin;
    columns.forEach((c) => {
      const text = String(c.cell(row, rowIndex) ?? '');
      const tx = c.align === 'right' ? xPos + c.width - 1 : xPos + 1;
      doc.text(text, tx, yPos, { maxWidth: c.width - 2, align: c.align === 'right' ? 'right' : 'left' });
      xPos += c.width;
    });
    yPos += 6;
  });

  // Totals row
  if (totals) {
    yPos += 4;
    if (yPos > pageHeight - 12) { doc.addPage(); yPos = margin + 4; }
    doc.setFillColor(200, 200, 200);
    doc.rect(margin, yPos - 4, tableWidth, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    let xPos = margin;
    columns.forEach((c, i) => {
      const val = totals[i];
      if (val != null) {
        const tx = c.align === 'right' ? xPos + c.width - 1 : xPos + 1;
        doc.text(String(val), tx, yPos, { maxWidth: c.width - 2, align: c.align === 'right' ? 'right' : 'left' });
      }
      xPos += c.width;
    });
  }

  doc.save(fileName);
  return true;
}

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

  const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  return true;
}
