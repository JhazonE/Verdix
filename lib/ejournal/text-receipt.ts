import { format } from 'date-fns';
import { formatSINumber } from '../si-number';
import { colsFor, money, center, row, divider, wrap } from './text-format';
import type { EJSettings, EJSale, EJVoided, EJCredit, EJReading, EJItem } from './types';

function layout(settings: EJSettings) {
  const cols = colsFor(settings.paperSize);
  const qtyW = cols === 48 ? 8 : 7;
  const amtW = cols === 48 ? 12 : 9;
  const nameW = cols - qtyW - amtW;
  return { cols, qtyW, amtW, nameW };
}

export function renderReceiptHeader(settings: EJSettings, dateTime: string): string[] {
  const cols = colsFor(settings.paperSize);
  const lines: string[] = [];
  lines.push(center(settings.businessName?.trim() || 'VENDIX', cols));
  lines.push(center(settings.address?.trim() || 'General Merchandise', cols));
  if (settings.contactNumber) lines.push(center(settings.contactNumber, cols));
  if (settings.tin) {
    const label = settings.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN';
    lines.push(center(`${label}: ${settings.tin}`, cols));
  }
  lines.push(center(`MIN: ${settings.minNumber || '1234567890'}`, cols));
  lines.push(center(`S/N: ${settings.serialNumber || '0987654321-11'}`, cols));
  lines.push(center(format(new Date(dateTime), 'PP p'), cols));
  return lines;
}

function renderItems(items: EJItem[], settings: EJSettings): string[] {
  const { cols, qtyW, amtW, nameW } = layout(settings);
  const lines: string[] = [];
  lines.push(
    'Qty'.padEnd(qtyW) + 'Item'.padEnd(nameW) + 'Amt'.padStart(amtW)
  );
  lines.push(divider(cols));
  for (const item of items) {
    const qtyText = `${item.quantity}${item.unitOfMeasure ? ' ' + item.unitOfMeasure : ''}`;
    const qty = qtyText.length > qtyW ? qtyText.substring(0, qtyW) : qtyText.padEnd(qtyW);
    const amtText = money(item.price * item.quantity);
    const amt = amtText.length > amtW ? amtText.substring(0, amtW) : amtText.padStart(amtW);
    const chunks = wrap(item.name.trim(), nameW);
    const padName = (s: string) => (s.length >= nameW ? s.substring(0, nameW) : s.padEnd(nameW));
    lines.push(`${qty}${padName(chunks[0] || '')}${amt}`);
    for (let i = 1; i < chunks.length; i++) {
      lines.push(' '.repeat(qtyW) + chunks[i]);
    }
    if (item.discount && item.discount > 0) {
      lines.push(' '.repeat(qtyW) + `Disc: ${money(item.discount)}`);
    }
    lines.push(' '.repeat(qtyW) + `@ ${money(item.price)}`);
  }
  return lines;
}

export function renderSalesReceiptText(sale: EJSale, settings: EJSettings): string {
  const { cols } = layout(settings);
  const out: string[] = [];
  out.push(...renderReceiptHeader(settings, sale.dateTime));
  out.push('');
  const title = sale.paymentMethod?.toUpperCase() === 'CHARGE' ? 'CHARGE INVOICE' : 'CASH INVOICE';
  out.push(center(title, cols));
  out.push(`SI NO.: ${formatSINumber(sale.siNumber)}`);
  out.push(`Cust: ${sale.customerName || 'Walk-in'}`);
  out.push(`Cashier: ${sale.cashierName || 'Admin'}`);
  if (sale.terminalName) out.push(`Terminal: ${sale.terminalName}`);
  out.push(divider(cols));
  out.push(...renderItems(sale.items, settings));
  out.push(divider(cols));
  out.push(row('TOTAL:', money(sale.total), cols));
  if (sale.vatAmount != null) out.push(row('VAT (12%):', money(sale.vatAmount), cols));
  return out.join('\n');
}

export function renderVoidSlipText(sale: EJVoided, settings: EJSettings): string {
  const { cols } = layout(settings);
  const out: string[] = [];
  out.push(...renderReceiptHeader(settings, sale.dateTime));
  out.push('');
  out.push(center('VOID SLIP', cols));
  out.push(`SI NO.: ${formatSINumber(sale.siNumber)}`);
  out.push(`Cust: ${sale.customerName || 'Walk-in'}`);
  out.push(`Cashier: ${sale.cashierName || 'Admin'}`);
  out.push(divider(cols));
  out.push(...renderItems(sale.items, settings));
  out.push(divider(cols));
  out.push(row('TOTAL VOIDED:', money(sale.total), cols));
  if (sale.voidReason) {
    out.push('Reason:');
    for (const line of wrap(sale.voidReason, cols)) out.push(line);
  }
  return out.join('\n');
}

export function renderCreditSlipText(credit: EJCredit, settings: EJSettings): string {
  const { cols } = layout(settings);
  const out: string[] = [];
  out.push(...renderReceiptHeader(settings, credit.dateTime));
  out.push('');
  out.push(center('MERCHANDISE CREDIT SLIP', cols));
  out.push(`SI NO.: ${formatSINumber(credit.creditSiNumber)}`);
  out.push(`Orig SI: ${formatSINumber(credit.originalSiNumber)}`);
  out.push(`Cust: ${credit.customerName || 'Walk-in'}`);
  out.push(`Cashier: ${credit.cashierName || 'Admin'}`);
  out.push(divider(cols));
  out.push(...renderItems(credit.items, settings));
  out.push(divider(cols));
  out.push(row('TOTAL CREDIT:', money(credit.total), cols));
  return out.join('\n');
}

export function renderReadingText(reading: EJReading, settings: EJSettings): string {
  const { cols } = layout(settings);
  const out: string[] = [];
  out.push(...renderReceiptHeader(settings, reading.reportDate));
  out.push('');
  out.push(center(`${reading.type}-READING`, cols));
  out.push(`No.: ${reading.readingNumber}`);
  out.push(`Date: ${reading.reportDate}`);
  if (reading.cashierName) out.push(`Cashier: ${reading.cashierName}`);
  out.push(divider(cols));
  out.push(row('Gross Sales:', money(reading.grossSales), cols));
  out.push(row('Returns:', money(reading.returns), cols));
  out.push(row('Discounts:', money(reading.discounts), cols));
  out.push(row('Net Sales:', money(reading.netSales), cols));
  out.push(row('VAT Amount:', money(reading.vatAmount), cols));
  out.push(row('Transactions:', String(reading.transactionCount), cols));
  return out.join('\n');
}
