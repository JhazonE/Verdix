'use client';

import { useRef } from 'react';
import { format } from 'date-fns';
import { formatQuantity } from '@/lib/utils';
import { abbreviateUOM } from '@/lib/receipt-uom';
import type { Sale } from '@/lib/types';
import type { POSSettings, OrderDialogMode } from './order-details-types';

type Props = {
  order: Sale | null;
  settings: POSSettings;
  mode: OrderDialogMode;
};

function itemUnitLabel(item: any): string {
  return item.sellingUnitName ? abbreviateUOM(item.sellingUnitName) : '';
}

export function useOrderPrint({ order, settings, mode }: Props) {
  const printContentRef = useRef<HTMLDivElement>(null);

  const documentTitle = mode === 'delivery-note' ? 'DELIVERY NOTE' : mode === 'invoice' ? 'INVOICE' : 'SALES ORDER';
  const displayDate = order ? (order.orderDate || order.date) : null;
  const subtotal = order ? order.items.reduce((sum, item) => sum + item.price * item.quantity, 0) : 0;
  const shipping = order ? Number((order as any).shipping || 0) : 0;
  const vatAmount = order ? Number(order.vatAmount || 0) : 0;
  const grandTotal = subtotal + shipping + vatAmount;

  const handlePrint = () => {
    const printContent = printContentRef.current;
    if (!printContent || !order) return;

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    const printStyles = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 40px; color: #000; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
        .logo-section { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
        .logo-placeholder { width: 80px; height: 80px; border: 2px solid #eee; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .logo-placeholder img { width: 100%; height: 100%; object-fit: cover; }
        .business-name { font-size: 20px; font-weight: bold; text-transform: uppercase; }
        .doc-title { font-size: 32px; font-weight: 900; font-style: italic; color: #333; margin-bottom: 20px; letter-spacing: -1px; }
        .info-table { border-collapse: collapse; margin-left: auto; font-size: 12px; }
        .info-table td { border: 1px solid #ddd; padding: 6px 12px; }
        .info-table td:first-child { background: #f8f9fa; font-weight: bold; width: 140px; }
        .info-table td:last-child { text-align: right; width: 160px; }
        .addresses { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin: 30px 0; }
        .address-section h3 { font-size: 13px; font-weight: bold; margin-bottom: 5px; }
        .address-section p { font-size: 13px; color: #333; margin: 2px 0; }
        .items-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 30px 0; }
        .items-table th { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 10px 4px; text-align: left; font-weight: bold; }
        .items-table th:nth-child(2) { text-align: center; }
        .items-table th:nth-child(n+3) { text-align: right; }
        .items-table td { padding: 12px 4px; border-bottom: 1px solid #eee; }
        .items-table td:nth-child(2) { text-align: center; }
        .items-table td:nth-child(n+3) { text-align: right; }
        .items-table td.amount { font-weight: bold; }
        .footer { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; }
        .terms h3 { font-size: 13px; font-weight: bold; margin-bottom: 8px; }
        .terms p { font-size: 11px; color: #666; white-space: pre-line; }
        .totals { font-size: 12px; }
        .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-weight: bold; }
        .totals-row.grand { font-size: 16px; font-weight: 900; border-top: 2px solid #000; padding-top: 8px; margin-top: 8px; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
      </style>
    `;

    const labelRef = mode === 'delivery-note' ? 'Reference Number'
      : documentTitle === 'SALES ORDER' ? 'Order Number' : 'Invoice Number';
    const labelDate = mode === 'delivery-note' ? 'Date'
      : documentTitle === 'SALES ORDER' ? 'Order Date' : 'Invoice Date';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${documentTitle} - ${order.reference || order.id}</title>
          ${printStyles}
        </head>
        <body>
          <div class="header">
            <div class="logo-section">
              <div class="logo-placeholder">
                ${settings.logoPath
                  ? `<img src="${settings.logoPath}" alt="Logo">`
                  : '<div style="width:100%;height:100%;background:#eee;display:flex;align-items:center;justify-content:center;font-size:24px">📄</div>'
                }
              </div>
              <div class="business-name">${settings.businessName || 'verdix'}</div>
            </div>
            <div>
              <div class="doc-title">${documentTitle}</div>
              <table class="info-table">
                <tr><td>${labelRef}</td><td>${order.reference || order.id}</td></tr>
                <tr><td>${labelDate}</td><td>${displayDate ? format(new Date(displayDate), 'MMMM d, yyyy') : 'N/A'}</td></tr>
                <tr><td>Payment Terms</td><td>${order.paymentMethod || 'CASH'}</td></tr>
                <tr><td>Sales Person</td><td>${order.salesPerson || 'N/A'}</td></tr>
                <tr><td>Due Date</td><td>${order.deliveryDate ? format(new Date(order.deliveryDate), 'MMMM d, yyyy') : (displayDate ? format(new Date(displayDate), 'MMMM d, yyyy') : '-')}</td></tr>
              </table>
            </div>
          </div>

          <div class="addresses">
            <div class="address-section">
              <h3>Bill to:</h3>
              <p>${order.customer.name}</p>
              <p>${order.customer.contactNumber || '-'}</p>
            </div>
            <div class="address-section">
              <h3>Ship to:</h3>
              <p>${order.customer.name}</p>
              <p>${order.deliveryAddress || '-'}</p>
              <p>${order.customer.contactNumber || '-'}</p>
            </div>
          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th>DESCRIPTION</th>
                <th style="width: 100px">QUANTITY</th>
                <th style="width: 100px">PRICE</th>
                <th style="width: 100px">DISCOUNT</th>
                <th style="width: 100px">AMOUNT</th>
                <th style="width: 60px; text-align: center;">VAT</th>
              </tr>
            </thead>
            <tbody>
              ${order.items.map(item => `
                <tr>
                  <td style="text-transform: uppercase; font-weight: 500;">${item.product.name}${itemUnitLabel(item) ? ` <span style="text-transform: none; font-weight: normal; color: #888;">(${itemUnitLabel(item)})</span>` : ''}</td>
                  <td>${formatQuantity(item.quantity)} ${(item.product as any).unit || 'pc'}</td>
                  <td>${item.price.toFixed(2)}</td>
                  <td>0.00</td>
                  <td class="amount">${(item.price * item.quantity).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style="text-align: center;"><span style="display: inline-block; width: 12px; height: 12px; border: 1px solid #555; line-height: 12px; font-size: 10px;">${(item as any).vatable ? '✓' : ''}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="footer">
            <div class="terms">
              <h3>Terms and Conditions</h3>
              <p>${(order as any).notes || (order as any).note || settings.salesOrderTerms || '-'}</p>
            </div>
            <div class="totals">
              <div class="totals-row"><span>SUBTOTAL</span><span>${subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
              <div class="totals-row"><span>SHIPPING</span><span>${shipping.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
              <div class="totals-row"><span>VAT (12%)</span><span>${vatAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
              <div class="totals-row grand"><span>GRAND TOTAL</span><span>${grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            </div>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const handlePrintPOSInvoice = () => {
    if (!order) return;
    const printWindow = window.open('', '_blank', 'width=350,height=600');
    if (!printWindow) return;

    const receiptStyles = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', Courier, monospace; font-size: 12px; width: 80mm; padding: 5mm; background: white; color: black; }
        .header { text-align: center; margin-bottom: 10px; }
        .business-name { font-weight: bold; font-size: 14px; }
        .address { font-size: 10px; }
        .dashed { border-top: 1px dashed #000; margin: 8px 0; }
        .title { text-align: center; font-weight: bold; font-size: 14px; margin: 10px 0; }
        .info-row { display: flex; justify-content: space-between; font-size: 11px; }
        .items { margin: 10px 0; }
        .item { margin-bottom: 5px; }
        .item-name { font-size: 11px; }
        .item-details { display: flex; justify-content: space-between; font-size: 10px; padding-left: 10px; }
        .totals { margin-top: 10px; }
        .total-row { display: flex; justify-content: space-between; font-size: 11px; }
        .total-row.grand { font-weight: bold; font-size: 14px; margin-top: 5px; padding-top: 5px; border-top: 1px dashed #000; }
        .footer { text-align: center; margin-top: 15px; font-size: 10px; }
        @media print { body { width: 80mm; margin: 0; padding: 3mm; } @page { size: 80mm auto; margin: 0; } }
      </style>
    `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>POS Invoice - ${order.reference || order.id}</title>
          ${receiptStyles}
        </head>
        <body>
          <div class="header">
            <div class="business-name">${settings.businessName || 'verdix'}</div>
            ${settings.address ? `<div class="address">${settings.address}</div>` : ''}
            ${settings.contactNumber ? `<div class="address">${settings.contactNumber}</div>` : ''}
            ${settings.tin ? `<div class="address">TIN: ${settings.tin}</div>` : ''}
          </div>

          <div class="dashed"></div>
          <div class="title">${documentTitle}</div>

          <div class="info-row"><span>Order #:</span><span>${order.reference || order.id}</span></div>
          <div class="info-row"><span>Date:</span><span>${displayDate ? format(new Date(displayDate), 'MM/dd/yyyy') : 'N/A'}</span></div>
          <div class="info-row"><span>Sales Person:</span><span>${order.salesPerson || 'N/A'}</span></div>
          <div class="info-row"><span>Customer:</span><span>${order.customer.name}</span></div>

          <div class="dashed"></div>

          <div class="items">
            ${order.items.map(item => `
              <div class="item">
                <div class="item-name">
                  ${item.product.name}${itemUnitLabel(item) ? ` (${itemUnitLabel(item)})` : ''}
                  ${item.product.barcode ? `<div style="font-size: 11px; color: #000; font-weight: bold; font-family: monospace;">BC: ${item.product.barcode}</div>` : ''}
                </div>
                <div class="item-details">
                  <span>${formatQuantity(item.quantity)} x ₱${item.price.toFixed(2)}</span>
                  <span>₱${(item.price * item.quantity).toFixed(2)}</span>
                </div>
                <div class="item-details"><span>VAT [${(item as any).vatable ? 'x' : ' '}]</span><span></span></div>
              </div>
            `).join('')}
          </div>

          <div class="dashed"></div>

          <div class="totals">
            <div class="total-row"><span>Subtotal:</span><span>₱${subtotal.toFixed(2)}</span></div>
            ${shipping > 0 ? `<div class="total-row"><span>Shipping:</span><span>₱${shipping.toFixed(2)}</span></div>` : ''}
            <div class="total-row"><span>VAT (12%):</span><span>₱${vatAmount.toFixed(2)}</span></div>
            <div class="total-row grand"><span>TOTAL:</span><span>₱${grandTotal.toFixed(2)}</span></div>
          </div>

          <div class="dashed"></div>

          <div class="footer">
            <p>Thank you for your order!</p>
            <p style="margin-top: 5px;">Printed: ${format(new Date(), 'MM/dd/yyyy hh:mm a')}</p>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  return {
    printContentRef,
    documentTitle,
    displayDate,
    subtotal,
    shipping,
    vatAmount,
    grandTotal,
    handlePrint,
    handlePrintPOSInvoice,
  };
}
