'use client';

import { useRef } from 'react';
import { format } from 'date-fns';
import { useReactToPrint } from 'react-to-print';
import { Button } from '@/components/ui/button';
import { Printer, FileText } from 'lucide-react';
import type { Sale } from '@/lib/types';
import { formatQuantity } from '@/lib/utils';
import { abbreviateUOM } from '@/lib/receipt-uom';
import type { PosSettings } from './use-invoices-query';

type Props = { order: Sale; title: string; settings: PosSettings | null; onBack: () => void };

function itemUnitLabel(item: any): string {
  return item.sellingUnitName ? abbreviateUOM(item.sellingUnitName) : '';
}

export function SalesInvoicePrintView({ order, title, settings, onBack }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const displayDate = order.invoiceDate || order.date;
  const subtotal = (order.items || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
  const shipping = Number((order as any).shipping || 0);
  const vatAmount = Number(order.vatAmount || 0);
  const grandTotal = subtotal + shipping + vatAmount;

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${title} - ${order.reference || (order as any).receiptNo || order.id.substring(0, 8)}`,
    pageStyle: `
      @page { size: 5.5in 8.5in; margin: 8mm; }
      @media print {
        html, body { visibility: visible !important; background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        * { visibility: visible !important; }
        .printable-area { position: static !important; width: auto !important; height: auto !important; min-height: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; background: #fff !important; }
      }
    `,
  });

  const handlePrintPOSInvoice = () => {
    const printWindow = window.open('', '_blank', 'width=350,height=600');
    if (!printWindow) return;
    const receiptStyles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', Courier, monospace; font-size: 12px; width: 80mm; padding: 5mm; background: white; color: black; } .header { text-align: center; margin-bottom: 10px; } .business-name { font-weight: bold; font-size: 14px; } .address { font-size: 10px; } .dashed { border-top: 1px dashed #000; margin: 8px 0; } .title { text-align: center; font-weight: bold; font-size: 14px; margin: 10px 0; } .info-row { display: flex; justify-content: space-between; font-size: 11px; } .items { margin: 10px 0; } .item { margin-bottom: 5px; } .item-name { font-size: 11px; } .item-details { display: flex; justify-content: space-between; font-size: 10px; padding-left: 10px; } .totals { margin-top: 10px; } .total-row { display: flex; justify-content: space-between; font-size: 11px; } .total-row.grand { font-weight: bold; font-size: 14px; margin-top: 5px; padding-top: 5px; border-top: 1px dashed #000; } .footer { text-align: center; margin-top: 15px; font-size: 10px; } @media print { body { width: 80mm; margin: 0; padding: 3mm; } @page { size: 80mm auto; margin: 0; } }</style>`;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>POS Invoice - ${order.reference || (order as any).receiptNo || order.id.substring(0, 8)}</title>${receiptStyles}</head><body><div class="header"><div class="business-name">${settings?.businessName || 'VENDIX'}</div>${settings?.address ? `<div class="address">${settings.address}</div>` : ''}${settings?.contactNumber ? `<div class="address">${settings.contactNumber}</div>` : ''}</div><div class="dashed"></div><div class="title">${title.toUpperCase()}</div><div class="info-row"><span>Ref #:</span><span>${order.reference || (order as any).receiptNo || order.id.substring(0, 8)}</span></div><div class="info-row"><span>Date:</span><span>${displayDate ? format(new Date(displayDate), 'MM/dd/yyyy') : 'N/A'}</span></div><div class="info-row"><span>Customer:</span><span>${order.customer?.name || 'Walk-in'}</span></div><div class="dashed"></div><div class="items">${(order.items || []).map(item => `<div class="item"><div class="item-name">${item.product?.name || (item as any).productName || 'Unknown'}${itemUnitLabel(item) ? ` (${itemUnitLabel(item)})` : ''}</div><div class="item-details"><span>${formatQuantity(item.quantity)} x ${Number(item.price || 0).toFixed(2)}</span><span>${(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</span></div><div class="item-details"><span>VAT [${(item as any).vatable ? 'x' : ' '}]</span><span></span></div></div>`).join('')}</div><div class="dashed"></div><div class="totals"><div class="total-row"><span>Subtotal:</span><span>${subtotal.toFixed(2)}</span></div>${shipping > 0 ? `<div class="total-row"><span>Shipping:</span><span>${shipping.toFixed(2)}</span></div>` : ''}<div class="total-row"><span>VAT (12%):</span><span>${vatAmount.toFixed(2)}</span></div><div class="total-row grand"><span>TOTAL:</span><span>${grandTotal.toFixed(2)}</span></div></div><div class="dashed"></div><div class="footer"><p>Thank you for your order!</p><p style="margin-top: 5px;">Printed: ${format(new Date(), 'MM/dd/yyyy hh:mm a')}</p></div></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  const handlePrintTemplate = () => {
    const printWindow = window.open('', '_blank', 'width=500,height=700');
    if (!printWindow) return;
    const templateStyles = `<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; padding: 8mm; } .header { text-align: center; margin-bottom: 8px; } .business-name { font-weight: bold; font-size: 14px; text-transform: uppercase; } .address { font-size: 10px; } .dashed { border-top: 1px dashed #000; margin: 6px 0; } .title { text-align: center; font-weight: bold; font-size: 13px; margin: 8px 0; text-transform: uppercase; } .info-row { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; } table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; } th, td { padding: 3px 4px; } th { border-bottom: 1px solid #000; text-transform: uppercase; text-align: left; } td.num, th.num { text-align: right; } td.center, th.center { text-align: center; } .totals { margin-top: 8px; } .total-row { display: flex; justify-content: space-between; font-size: 11px; padding: 1px 0; } .total-row.grand { font-weight: bold; font-size: 13px; border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; } .signatures { display: flex; justify-content: space-between; margin-top: 24px; } .sig-box { width: 45%; text-align: center; } .sig-line { border-top: 1px solid #000; margin-bottom: 3px; } .sig-label { font-size: 8px; text-transform: uppercase; } @media print { @page { size: 5.5in 8.5in; margin: 8mm; } body { padding: 0; } }</style>`;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>${title} - ${order.reference || (order as any).receiptNo || order.id.substring(0, 8)}</title>${templateStyles}</head><body><div class="header"><div class="business-name">${settings?.businessName || 'VENDIX'}</div>${settings?.address ? `<div class="address">${settings.address}</div>` : ''}${settings?.contactNumber ? `<div class="address">${settings.contactNumber}</div>` : ''}</div><div class="dashed"></div><div class="title">${title}</div><div class="info-row"><span>Invoice #:</span><span>${order.reference || (order as any).receiptNo || order.id.substring(0, 8)}</span></div><div class="info-row"><span>Date:</span><span>${displayDate ? format(new Date(displayDate), 'MMM dd, yyyy') : 'N/A'}</span></div><div class="info-row"><span>Bill To:</span><span>${order.customer?.name || 'Walk-in Customer'}</span></div><table><thead><tr><th>Description</th><th class="center">Qty</th><th class="num">Price</th><th class="num">Amount</th><th class="center">VAT</th></tr></thead><tbody>${(order.items || []).map(item => `<tr><td>${item.product?.name || (item as any).productName || 'Unknown'}${itemUnitLabel(item) ? ` (${itemUnitLabel(item)})` : ''}</td><td class="center">${formatQuantity(item.quantity)}</td><td class="num">${Number(item.price || 0).toFixed(2)}</td><td class="num">${(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</td><td class="center">${(item as any).vatable ? '✓' : ''}</td></tr>`).join('')}</tbody></table><div class="dashed"></div><div class="totals"><div class="total-row"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>${shipping > 0 ? `<div class="total-row"><span>Shipping</span><span>${shipping.toFixed(2)}</span></div>` : ''}<div class="total-row"><span>VAT (12%)</span><span>${vatAmount.toFixed(2)}</span></div><div class="total-row grand"><span>Total</span><span>${grandTotal.toFixed(2)}</span></div></div><div class="signatures"><div class="sig-box"><div class="sig-line">&nbsp;</div><div class="sig-label">Authorized Signature</div></div><div class="sig-box"><div class="sig-line">&nbsp;</div><div class="sig-label">Customer's Signature</div></div></div></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
  };

  return (
    <div className="w-full bg-white text-black flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-12 bg-slate-100/50 non-printable flex justify-center">
        <div ref={printRef} className="printable-area space-y-4 p-[10mm] bg-white text-black shadow-xl border w-[5.5in] min-h-[8.5in] mx-auto print:shadow-none print:border-none print:p-0 print:w-full print:min-h-0">
          <div className="flex justify-between items-start mb-4">
            <div className="flex flex-col items-start gap-1">
              <div className="h-10 w-10 flex items-center justify-center border-2 border-slate-100 rounded-full overflow-hidden mb-1">
                {settings?.logoPath ? (
                  <img src={settings.logoPath} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-slate-100 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-slate-400" />
                  </div>
                )}
              </div>
              <h1 className="text-xs font-bold uppercase tracking-tight">{settings?.businessName || 'VENDIX'}</h1>
              <p className="text-[8px] leading-tight text-slate-500 max-w-[120px]">{settings?.address}</p>
            </div>
            <div className="text-right">
              <h2 className="text-lg font-black uppercase italic tracking-tighter text-slate-800 mb-2">{title.toUpperCase()}</h2>
              <table className="text-[10px] ml-auto border-collapse">
                <tbody>
                  <tr>
                    <td className="px-2 py-1 bg-slate-50 border border-slate-200 font-bold text-left w-24">Invoice Number</td>
                    <td className="px-2 py-1 border border-slate-200 text-right min-w-[100px]">{order.reference || (order as any).receiptNo || order.id.substring(0, 8)}</td>
                  </tr>
                  <tr>
                    <td className="px-2 py-1 bg-slate-50 border border-slate-200 font-bold text-left">Invoice Date</td>
                    <td className="px-2 py-1 border border-slate-200 text-right">{displayDate ? format(new Date(displayDate), 'MMM dd, yyyy') : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="px-2 py-1 bg-slate-50 border border-slate-200 font-bold text-left">Due Date</td>
                    <td className="px-2 py-1 border border-slate-200 text-right">{order.dueDate ? format(new Date(order.dueDate), 'MMM dd, yyyy') : (displayDate ? format(new Date(displayDate), 'MMM dd, yyyy') : 'N/A')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4 text-[10px]">
            <div>
              <p className="font-bold uppercase text-[9px] text-slate-400 mb-1">Bill To:</p>
              <p className="font-bold text-sm">{order.customer?.name || 'Walk-in Customer'}</p>
              <p className="text-slate-500 whitespace-pre-wrap leading-tight mt-1">{order.customer?.address || 'Store'}</p>
            </div>
            <div>
              <p className="font-bold uppercase text-[9px] text-slate-400 mb-1">Ship To:</p>
              <p className="font-bold text-sm">{order.customer?.name || 'Walk-in Customer'}</p>
              <p className="text-slate-500 whitespace-pre-wrap leading-tight mt-1">{order.customer?.address || 'Store'}</p>
            </div>
          </div>

          <div className="mb-4">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-y-2 border-slate-800">
                  <th className="text-left py-2 uppercase font-bold tracking-wider">Description</th>
                  <th className="text-center py-2 uppercase font-bold tracking-wider w-16">Qty</th>
                  <th className="text-right py-2 uppercase font-bold tracking-wider w-24">Price</th>
                  <th className="text-right py-2 uppercase font-bold tracking-wider w-24">Amount</th>
                  <th className="text-center py-2 uppercase font-bold tracking-wider w-14">VAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(order.items || []).map((item, index) => (
                  <tr key={index}>
                    <td className="py-2.5 font-medium uppercase">
                      {item.product?.name || (item as any).productName || 'Unknown Product'}
                      {itemUnitLabel(item) && (
                        <span className="ml-1.5 font-normal normal-case text-slate-400">({itemUnitLabel(item)})</span>
                      )}
                    </td>
                    <td className="py-2.5 text-center">{formatQuantity(item.quantity)}</td>
                    <td className="py-2.5 text-right">{Number(item.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="py-2.5 text-right font-bold">{(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="py-2.5 text-center">
                      <span
                        className="inline-block w-3.5 h-3.5 border border-slate-500 leading-none align-middle"
                        aria-label={(item as any).vatable ? 'Subject to VAT' : 'VAT-exempt'}
                      >
                        {(item as any).vatable ? '✓' : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end mb-4">
            <div className="w-full max-w-[160px] space-y-1 text-[10px]">
              {[['SUBTOTAL', subtotal], ['SHIPPING', shipping], ['VAT (12%)', vatAmount]].map(([label, val]) => (
                <div key={label as string} className="flex justify-between">
                  <span className="font-bold">{label}</span>
                  <span>{Number(val).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))}
              <div className="flex justify-between font-black text-sm border-t-2 border-slate-800 pt-1.5">
                <span>GRAND TOTAL</span>
                <span>{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mt-8 print:mt-10">
            {['Authorized Signature', "Customer's Signature"].map(label => (
              <div key={label} className="text-center">
                <div className="border-b border-slate-300 w-full mb-1 h-6" />
                <p className="text-[7px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-3 non-printable p-4 bg-slate-50 border-t w-full shrink-0 print:hidden">
        <Button variant="outline" size="sm" onClick={() => handlePrint()} className="h-10 px-6 font-bold text-xs uppercase tracking-tight shadow-sm bg-white">
          <Printer className="mr-2 h-4 w-4" /> Print
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrintPOSInvoice} className="h-10 px-6 font-bold text-xs uppercase tracking-tight shadow-sm bg-white">
          <Printer className="mr-2 h-4 w-4" /> Print POS Invoice
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrintTemplate} className="h-10 px-6 font-bold text-xs uppercase tracking-tight shadow-sm bg-white">
          <Printer className="mr-2 h-4 w-4" /> Print to template
        </Button>
        <Button variant="outline" size="sm" onClick={onBack} className="h-10 px-6 font-bold text-xs uppercase tracking-tight bg-white">
          Close
        </Button>
      </div>
    </div>
  );
}
