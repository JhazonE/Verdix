'use client';

import React, { forwardRef } from 'react';
import { format, addYears } from 'date-fns';
import { formatQuantity } from '@/lib/utils';
import { formatSINumber } from '@/lib/si-number';
import { useReceipt } from './use-receipt';
import type { ReceiptViewProps } from './receipt-types';

export const ReceiptView = forwardRef<HTMLDivElement, ReceiptViewProps>(({ saleDetails, settings }, ref) => {
    const { items, customer, totalDue, change, paymentMethod } = saleDetails;
    const { subTotal, totalDiscount, vatAmount, formatCurrency, currentDate, discountHolderName, discountIdNumber, discountTypeLabel, paperWidth } = useReceipt({
        items,
        totalDue,
        saleDetails,
        settings,
    });

    return (
        <div
            ref={ref}
            className={`printable-area bg-white text-black px-2 py-4 text-[10px] font-mono font-bold ${paperWidth} mx-auto leading-tight`}
            style={{
                wordBreak: 'break-word',
                minWidth: settings?.paperSize === '80mm' ? '80mm' : '58mm',
                maxWidth: settings?.paperSize === '80mm' ? '80mm' : '58mm'
            }}
        >
            <div className="text-center mb-4">
                <div className="font-bold text-lg mb-1">{settings?.businessName?.trim() || 'VENDIX'}</div>
                <div>{settings?.address?.trim() || 'General Merchandise'}</div>
                {settings?.contactNumber && <div>{settings.contactNumber}</div>}
                {settings?.tin && <div>{settings?.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN'}: {settings.tin}</div>}
                <div>MIN: {saleDetails.terminalMin || settings?.minNumber || '1234567890'}</div>
                <div>S/N: {saleDetails.terminalSerialNumber || settings?.serialNumber || '0987654321-11'}</div>
                {saleDetails.terminalAccreditationNo && <div>ACCR NO: {saleDetails.terminalAccreditationNo}</div>}
                {saleDetails.terminalPermitNo && <div>PTU NO: {saleDetails.terminalPermitNo}</div>}
                <div className="text-[10px]">{format(currentDate, 'PP p')}</div>
            </div>

            <div className="mb-2 border-b border-dashed border-black pb-2">
                <div className="font-bold text-center border-y border-black py-1 mb-1 uppercase">
                    {saleDetails.birOrNumber ? 'OFFICIAL RECEIPT' : 'SALES INVOICE'}
                </div>
                {saleDetails.birOrNumber ? (
                    <div className="font-bold">OR NO.: {saleDetails.birOrNumber}</div>
                ) : (
                    <div className="font-bold">SI NO.: {formatSINumber(saleDetails.siNumber || saleDetails.orderNumber)}</div>
                )}
                {saleDetails.isReprint && (
                    <div className="text-center">
                        <div className="font-bold">*** REPRINT ***</div>
                        <div>Reprinted: {format(new Date(), 'PP p')}</div>
                    </div>
                )}
                <div>Cust: {customer?.name || 'Walk-in'}</div>
                <div>Cashier: {saleDetails.cashierName || 'Admin'}</div>
                {saleDetails.terminalName && <div>Terminal: {saleDetails.terminalName}</div>}
            </div>

            <div className="mb-2">
                <div className="flex justify-between font-bold border-b border-black mb-1 text-[10px]">
                    <span className="w-10 text-left">Qty</span>
                    <span className="flex-1 text-left px-1">Item</span>
                    <span className="w-12 text-right">Amt</span>
                </div>
                {items.map((item, index) => (
                    <div key={index} className="flex justify-between mb-1 items-start text-[10px]">
                        <span className="w-10 text-left">{formatQuantity(item.quantity)} {item.unitOfMeasure}</span>
                        <span className="flex-1 text-left px-1">
                            <div>{item.name}</div>
                            {item.discount > 0 && <div className="text-[9px] italic">Disc: {item.discount}%</div>}
                            <div className="text-black">@ {formatCurrency(item.price)}</div>
                        </span>
                        <span className="w-12 text-right">{formatCurrency(item.price * item.quantity)}</span>
                    </div>
                ))}
            </div>

            <div className="border-t border-dashed border-black pt-2 space-y-1">
                <div className="flex justify-between">
                    <span>SUBTOTAL:</span>
                    <span>{formatCurrency(subTotal)}</span>
                </div>
                {totalDiscount > 0 && (
                    <div className="flex justify-between">
                    <span>Discount:</span>
                    <span>-{formatCurrency(totalDiscount)}</span>
                </div>
                )}
                <div className="flex justify-between font-bold text-sm mt-2">
                    <span>AMOUNT DUE:</span>
                    <span>{formatCurrency(totalDue)}</span>
                </div>
                {!saleDetails.taxBreakdown && (
                    <div className="flex justify-between text-[10px]">
                        <span>VAT (12%):</span>
                        <span>{formatCurrency(vatAmount)}</span>
                    </div>
                )}
            </div>

            <div className="border-t border-black my-2"></div>

            <div className="space-y-1">
                {saleDetails.pointsUsedValue && saleDetails.pointsUsedValue > 0 ? (
                    <>
                        <div className="flex justify-between font-bold">
                            <span>Points Value to Redeem:</span>
                            <span>-{formatCurrency(saleDetails.pointsUsedValue)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                            <span>Net Balance Due:</span>
                            <span>{formatCurrency(totalDue - saleDetails.pointsUsedValue)}</span>
                        </div>
                    </>
                ) : null}

                {saleDetails.payments && saleDetails.payments.length > 0 ? (
                    saleDetails.payments.map((p, idx) => (
                        <div key={idx}>
                            <div className="flex justify-between font-bold">
                                <span>{p.method.toUpperCase() === 'CASH' ? 'CASH:' : p.method + ':'}</span>
                                <span>{formatCurrency(p.amount)}</span>
                            </div>
                            {p.reference && (
                                <div className="flex justify-between font-bold text-[9px]">
                                    <span>REF NO:</span>
                                    <span>{p.reference}</span>
                                </div>
                            )}
                        </div>
                    ))
                ) : (
                    <>
                        <div className="flex justify-between font-bold">
                            <span>{saleDetails.pointsUsedValue && saleDetails.pointsUsedValue > 0 ? 'CASH Tendered:' : (paymentMethod?.toUpperCase() === 'CASH' ? 'CASH:' : paymentMethod + ':')}</span>
                            <span>{formatCurrency(saleDetails.amountTendered || (totalDue + change))}</span>
                        </div>

                        {saleDetails.paymentReference && (
                            <div className="flex justify-between font-bold text-[9px]">
                                <span>REF NO:</span>
                                <span>{saleDetails.paymentReference}</span>
                            </div>
                        )}
                    </>
                )}

                {change > 0 && (
                    <div className="flex justify-between font-bold">
                        <span>CHANGE:</span>
                        <span>{formatCurrency(change)}</span>
                    </div>
                )}
            </div>

            {(discountHolderName || discountIdNumber) && (
                <div className="border-t border-dashed border-black mt-2 pt-2 space-y-1">
                    <div className="text-center font-bold">
                        {discountTypeLabel ? `${discountTypeLabel} DISCOUNT` : 'DISCOUNT DETAILS'}
                    </div>
                    <div className="flex justify-between">
                        <span>NAME:</span>
                        <span className="text-right break-all">{discountHolderName || '____________'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>ID NO.:</span>
                        <span className="text-right break-all">{discountIdNumber || '____________'}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>SIGNATURE:</span>
                        <span>____________</span>
                    </div>
                </div>
            )}

            {saleDetails.taxBreakdown ? (
                <div className="border-t border-dashed border-black mt-2 pt-2 space-y-1">
                    <div className="flex justify-between">
                        <span>VAT SALES</span>
                        <span>{formatCurrency(saleDetails.taxBreakdown.vatableSales)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>12% VAT</span>
                        <span>{formatCurrency(saleDetails.taxBreakdown.vatAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>VAT-EXEMPT SALES</span>
                        <span>{formatCurrency(saleDetails.taxBreakdown.vatExemptSales)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>ZERO-RATED SALES</span>
                        <span>{formatCurrency(saleDetails.taxBreakdown.zeroRatedSales)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>NON-VAT SALES</span>
                        <span>{formatCurrency(saleDetails.taxBreakdown.nonVatSales)}</span>
                    </div>
                </div>
            ) : (
                <div className="border-t border-dashed border-black mt-2 pt-2">
                    <div className="flex justify-between text-[10px]">
                        <span>VAT (12%):</span>
                        <span>{formatCurrency(vatAmount)}</span>
                    </div>
                </div>
            )}

            {(saleDetails.pointsEarned && saleDetails.pointsEarned > 0) || (saleDetails.pointsUsedCount && saleDetails.pointsUsedCount > 0) || (saleDetails.pointsBalance !== undefined) ? (
                <div className="mt-2 pt-2 border-t border-dashed border-black">
                    <div className="text-center font-bold mb-1">LOYALTY STATEMENT</div>
                    {saleDetails.pointsUsedCount && saleDetails.pointsUsedCount > 0 && (
                        <div className="flex justify-between">
                            <span>Used Points:</span>
                            <span>{formatQuantity(saleDetails.pointsUsedCount)} pts</span>
                        </div>
                    )}
                    {saleDetails.pointsEarned && saleDetails.pointsEarned > 0 && (
                        <div className="flex justify-between">
                            <span>Earned Points:</span>
                            <span>{formatQuantity(saleDetails.pointsEarned)} pts</span>
                        </div>
                    )}
                    {saleDetails.pointsBalance !== undefined && (
                        <div className="flex justify-between font-bold">
                            <span>New Balance:</span>
                            <span>{formatQuantity(Number(saleDetails.pointsBalance))} pts</span>
                        </div>
                    )}
                </div>
            ) : null}
            <div className="text-center mt-6">
                {!saleDetails.isTrainingMode && (
                    <div className="text-[9px] leading-tight mb-2 space-y-0.5">
                        {saleDetails.terminalPermitNo && (
                            <div>
                                This invoice/receipt shall be valid for five (5) years from the date of the permit to use
                                {saleDetails.terminalPermitDateIssued ? ` (until ${format(addYears(new Date(saleDetails.terminalPermitDateIssued), 5), 'MM/dd/yyyy')}).` : '.'}
                            </div>
                        )}
                        {settings?.vatRegistration === 'NON_VAT' && (
                            <div>THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</div>
                        )}
                        <div>ASK FOR RECEIPT!</div>
                    </div>
                )}
                <div>Shop smart, save more! Thank you for visiting {settings?.businessName?.trim() || 'VENDIX'}.</div>
                {saleDetails.isTrainingMode && (
                    <div className="mt-4 border-2 border-black p-2 bg-gray-100 text-center font-bold text-[10px] leading-tight flex flex-col gap-1">
                        <div>THIS IS NOT A SALES INVOICE RECEIPT.</div>
                        <div>PLEASE REQUEST FROM SELLER YOUR SALES INVOICE/OFFICIAL RECEIPT</div>
                    </div>
                )}
            </div>
        </div>
    );
});

ReceiptView.displayName = 'ReceiptView';
