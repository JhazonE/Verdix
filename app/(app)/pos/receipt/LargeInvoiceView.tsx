'use client';

import { forwardRef } from 'react';
import { format } from 'date-fns';
import { formatQuantity } from '@/lib/utils';
import { formatSINumber } from '@/lib/si-number';
import { receiptLineQuantity } from '@/lib/receipt-uom';
import { useReceipt } from './use-receipt';
import type { ReceiptViewProps } from './receipt-types';

// Mirrors the "Print to template" layout from SalesInvoicePrintView.tsx
// (handlePrintTemplate) so the two invoice templates look identical —
// this one is just fed from POS sale data instead of a Sale order object.
export const LargeInvoiceView = forwardRef<HTMLDivElement, ReceiptViewProps>(({ saleDetails, settings }, ref) => {
    const { items, customer, totalDue, change, paymentMethod, payments } = saleDetails;
    const { subTotal, vatAmount, currentDate } = useReceipt({
        items,
        totalDue,
        saleDetails,
        settings,
    });

    const invoiceNumber = saleDetails.birOrNumber || formatSINumber(saleDetails.siNumber || saleDetails.orderNumber);
    const grandTotal = subTotal + vatAmount;

    return (
        <div
            ref={ref}
            className="printable-area bg-white text-black"
            style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', padding: '8mm', width: '5.5in', minHeight: '8.5in', boxSizing: 'border-box' }}
        >
            <div className="text-center" style={{ marginBottom: '8px' }}>
                <div className="font-bold uppercase" style={{ fontSize: '14px' }}>{settings?.businessName || 'VENDIX'}</div>
                {settings?.address && <div style={{ fontSize: '10px' }}>{settings.address}</div>}
                {settings?.contactNumber && <div style={{ fontSize: '10px' }}>{settings.contactNumber}</div>}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            <div className="flex justify-between" style={{ fontSize: '10px', marginBottom: '2px', marginTop: '8px' }}>
                <span>Reference #:</span>
                <span>{invoiceNumber}</span>
            </div>
            <div className="flex justify-between" style={{ fontSize: '10px', marginBottom: '2px' }}>
                <span>Date:</span>
                <span>{format(currentDate, 'MMM dd, yyyy')}</span>
            </div>
            <div className="flex justify-between" style={{ fontSize: '10px', marginBottom: '2px' }}>
                <span>Bill To:</span>
                <span>{customer?.name || 'Walk-in Customer'}</span>
            </div>
            {saleDetails.terminalName && (
                <div className="flex justify-between" style={{ fontSize: '10px', marginBottom: '2px' }}>
                    <span>Terminal:</span>
                    <span>{saleDetails.terminalName}</span>
                </div>
            )}
            <div className="flex justify-between" style={{ fontSize: '10px', marginBottom: '2px' }}>
                <span>Cashier:</span>
                <span>{saleDetails.cashierName || 'Admin'}</span>
            </div>

            <table className="w-full" style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: '10px' }}>
                <thead>
                    <tr>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'left' }}>Description</th>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'center' }}>Qty</th>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'right' }}>Price</th>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'center' }}>VAT</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, index) => {
                        const lineQty = receiptLineQuantity(item);
                        const unit = lineQty.soldAs ? `${formatQuantity(lineQty.soldAs.qty)} ${lineQty.soldAs.uom}` : lineQty.uom;
                        const isVatable = (item.taxType || 'VAT') === 'VAT';
                        return (
                            <tr key={index}>
                                <td style={{ padding: '3px 4px' }}>{item.name}{unit ? ` (${unit})` : ''}</td>
                                <td style={{ padding: '3px 4px', textAlign: 'center' }}>{formatQuantity(lineQty.qty)}{lineQty.soldAs ? ` ${lineQty.uom}` : ''}</td>
                                <td style={{ padding: '3px 4px', textAlign: 'right' }}>{Number(item.price || 0).toFixed(2)}</td>
                                <td style={{ padding: '3px 4px', textAlign: 'right' }}>{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</td>
                                <td style={{ padding: '3px 4px', textAlign: 'center' }}>{isVatable ? '✓' : ''}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            <div style={{ marginTop: '8px' }}>
                <div className="flex justify-between" style={{ fontSize: '11px', padding: '1px 0' }}>
                    <span>Subtotal</span>
                    <span>{subTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between" style={{ fontSize: '11px', padding: '1px 0' }}>
                    <span>VAT (12%)</span>
                    <span>{vatAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold" style={{ fontSize: '13px', borderTop: '1px solid #000', marginTop: '4px', paddingTop: '4px' }}>
                    <span>Total</span>
                    <span>{grandTotal.toFixed(2)}</span>
                </div>

                {payments && payments.length > 0 ? (
                    payments.map((p, idx) => (
                        <div key={idx}>
                            <div className="flex justify-between" style={{ fontSize: '11px', padding: '1px 0' }}>
                                <span>{p.method.toUpperCase() === 'CASH' ? 'Cash' : p.method}</span>
                                <span>{Number(p.amount || 0).toFixed(2)}</span>
                            </div>
                            {p.reference && (
                                <div className="flex justify-between" style={{ fontSize: '9px', padding: '1px 0' }}>
                                    <span>Ref No.</span>
                                    <span>{p.reference}</span>
                                </div>
                            )}
                        </div>
                    ))
                ) : (
                    <>
                        <div className="flex justify-between" style={{ fontSize: '11px', padding: '1px 0' }}>
                            <span>{paymentMethod?.toUpperCase() === 'CASH' ? 'Cash' : paymentMethod}</span>
                            <span>{Number(saleDetails.amountTendered ?? (totalDue + change)).toFixed(2)}</span>
                        </div>
                        {saleDetails.paymentReference && (
                            <div className="flex justify-between" style={{ fontSize: '9px', padding: '1px 0' }}>
                                <span>Ref No.</span>
                                <span>{saleDetails.paymentReference}</span>
                            </div>
                        )}
                    </>
                )}

                {change > 0 && (
                    <div className="flex justify-between font-bold" style={{ fontSize: '11px', padding: '1px 0' }}>
                        <span>Change</span>
                        <span>{Number(change).toFixed(2)}</span>
                    </div>
                )}
            </div>

            <div className="flex justify-between" style={{ marginTop: '24px' }}>
                <div style={{ width: '45%', textAlign: 'center' }}>
                    <div style={{ borderTop: '1px solid #000', marginBottom: '3px' }}>&nbsp;</div>
                    <div style={{ fontSize: '8px', textTransform: 'uppercase' }}>Authorized Signature</div>
                </div>
                <div style={{ width: '45%', textAlign: 'center' }}>
                    <div style={{ borderTop: '1px solid #000', marginBottom: '3px' }}>&nbsp;</div>
                    <div style={{ fontSize: '8px', textTransform: 'uppercase' }}>Customer's Signature</div>
                </div>
            </div>
        </div>
    );
});

LargeInvoiceView.displayName = 'LargeInvoiceView';
