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
    const { subTotal, currentDate } = useReceipt({
        items,
        totalDue,
        saleDetails,
        settings,
    });

    const invoiceNumber = saleDetails.birOrNumber || formatSINumber(saleDetails.siNumber || saleDetails.orderNumber);
    // Philippine prices are VAT-inclusive: useReceipt extracts vatAmount out of the
    // line totals rather than adding it on, so the subtotal IS the amount due.
    const grandTotal = subTotal;

    // Counts in the unit each line was SOLD in, matching the Qty column: a case of
    // 12 counts as 1 thing to hand over, not 12. Fractional lines (0.5 kg) are
    // floored out of the count since they are weighed, not counted.
    const countedItems = items.reduce((acc, item) => {
        const qty = Number(item.quantity || 0);
        return acc + (Number.isInteger(qty) ? qty : 0);
    }, 0);

    return (
        <div
            ref={ref}
            className="printable-area bg-white text-black"
            style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', padding: '6mm 8mm', width: '8in', minHeight: '5in', boxSizing: 'border-box' }}
        >
            <div className="text-center" style={{ marginBottom: '8px' }}>
                <div className="font-bold uppercase" style={{ fontSize: '14px' }}>{settings?.businessName || 'VENDIX'}</div>
                {settings?.address && <div style={{ fontSize: '10px' }}>{settings.address}</div>}
                {settings?.contactNumber && <div style={{ fontSize: '10px' }}>{settings.contactNumber}</div>}
            </div>

            <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

            {/* Landscape stock is too wide to space label and value apart, so the
                header reads as two compact columns instead of full-width rows. */}
            <div className="flex" style={{ fontSize: '10px', marginTop: '8px', gap: '32px' }}>
                <div style={{ flex: 1 }}>
                    <div className="flex" style={{ marginBottom: '2px' }}>
                        <span style={{ width: '90px' }}>Reference #:</span>
                        <span>{invoiceNumber}</span>
                    </div>
                    <div className="flex" style={{ marginBottom: '2px' }}>
                        <span style={{ width: '90px' }}>Date:</span>
                        <span>{format(currentDate, 'MMM dd, yyyy')}</span>
                    </div>
                    <div className="flex" style={{ marginBottom: '2px' }}>
                        <span style={{ width: '90px' }}>Bill To:</span>
                        <span>{customer?.name || 'Walk-in Customer'}</span>
                    </div>
                </div>
                <div style={{ flex: 1 }}>
                    {saleDetails.terminalName && (
                        <div className="flex" style={{ marginBottom: '2px' }}>
                            <span style={{ width: '90px' }}>Terminal:</span>
                            <span>{saleDetails.terminalName}</span>
                        </div>
                    )}
                    <div className="flex" style={{ marginBottom: '2px' }}>
                        <span style={{ width: '90px' }}>Cashier:</span>
                        <span>{saleDetails.cashierName || 'Admin'}</span>
                    </div>
                </div>
            </div>

            <table className="w-full" style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: '10px' }}>
                <thead>
                    <tr>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'left' }}>Description</th>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'center', width: '0.9in' }}>Qty</th>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'right', width: '1in' }}>Price</th>
                        <th style={{ padding: '3px 4px', borderBottom: '1px solid #000', textTransform: 'uppercase', textAlign: 'right', width: '1.1in' }}>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((item, index) => {
                        const lineQty = receiptLineQuantity(item);
                        // A non-base unit keeps its equivalence beside the name
                        // ("1 cs"); the base unit needs none, since the Qty column
                        // now carries the abbreviation itself.
                        const soldAs = lineQty.soldAs
                            ? `${formatQuantity(lineQty.soldAs.qty)} ${lineQty.soldAs.uom}`
                            : '';
                        return (
                            <tr key={index}>
                                <td style={{ padding: '3px 4px' }}>{item.name}{soldAs ? ` (${soldAs})` : ''}</td>
                                <td style={{ padding: '3px 4px', textAlign: 'center' }}>{formatQuantity(lineQty.qty)}{lineQty.uom ? ` ${lineQty.uom}` : ''}</td>
                                <td style={{ padding: '3px 4px', textAlign: 'right' }}>{Number(item.price || 0).toFixed(2)}</td>
                                <td style={{ padding: '3px 4px', textAlign: 'right' }}>{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {/* Counted items sits opposite the totals, so the sheet can be checked
                against what was physically handed over without re-reading the table. */}
            <div className="flex" style={{ marginTop: '8px', alignItems: 'flex-start' }}>
                <div className="font-bold" style={{ fontSize: '10px', paddingTop: '4px' }}>
                    Counted Items: {countedItems}
                    {' '}({items.length} {items.length === 1 ? 'line' : 'lines'})
                </div>

                <div style={{ width: '2.8in', marginLeft: 'auto' }}>
                    {/* No Subtotal line: with VAT removed it would just repeat Total. */}
                    <div className="flex justify-between font-bold" style={{ fontSize: '13px', borderTop: '1px solid #000', paddingTop: '4px' }}>
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
            </div>

            <div className="flex justify-between" style={{ marginTop: '108px' }}>
                {['Prepared By', 'Checked By', 'Received By'].map(label => (
                    <div key={label} style={{ width: '31%', textAlign: 'center' }}>
                        <div style={{ borderTop: '1px solid #000', marginBottom: '3px' }}>&nbsp;</div>
                        <div style={{ fontSize: '8px', textTransform: 'uppercase' }}>{label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
});

LargeInvoiceView.displayName = 'LargeInvoiceView';
