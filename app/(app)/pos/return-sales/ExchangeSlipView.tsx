import React, { forwardRef } from 'react';
import { format } from 'date-fns';
import type { SystemSettings } from '@/lib/types';

export interface ExchangeSlipViewProps {
  exchangeDetails: {
    mcNumber: string | null;
    siNumber: string | null;
    date: string;
    cashierName: string;
    customerName: string;
    returnedItem: { name: string; quantity: number; price: number; total: number };
    newItem: { name: string; quantity: number; price: number; total: number };
    balance: number;
  };
  settings?: SystemSettings | null;
}

export const ExchangeSlipView = forwardRef<HTMLDivElement, ExchangeSlipViewProps>(({ exchangeDetails, settings }, ref) => {
  const { mcNumber, siNumber, date, cashierName, customerName, returnedItem, newItem, balance } = exchangeDetails;
  const formatCurrency = (amount: number) => amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const currentDate = date ? new Date(date) : new Date();
  const isEven = Math.abs(balance) < 0.005;
  const isUpsell = balance > 0.005;

  return (
    <div ref={ref} className="printable-area bg-white text-black p-4 text-[10px] font-mono font-bold w-[58mm] mx-auto print:w-auto print:ml-1 print:mr-6 leading-tight">
      <div className="text-center mb-4">
        <div className="font-bold text-lg mb-1">{settings?.businessName || 'VENDIX'}</div>
        <div>{settings?.address || 'General Merchandise'}</div>
        {settings?.contactNumber && <div>{settings.contactNumber}</div>}
        {settings?.tin && <div>VAT REG TIN: {settings.tin}</div>}
        <div className="text-[10px]">{format(currentDate, 'PP p')}</div>
      </div>

      <div className="mb-2 border-b border-dashed border-black pb-2">
        <div className="font-bold text-center border-y border-black py-1 mb-1 uppercase">
          Exchange Slip
        </div>
        {siNumber && <div className="mt-1">SI NO.: {siNumber}</div>}
        {mcNumber && <div className="font-bold text-xs">MC NO.: {mcNumber}</div>}
        <div>Cust: {customerName}</div>
        <div>Cashier: {cashierName}</div>
      </div>

      <div className="mb-2">
        <div className="font-bold border-b border-black mb-1">RETURNED</div>
        <div className="mb-1">
          <div>{returnedItem.quantity} x {returnedItem.name}</div>
          <div>@ {formatCurrency(returnedItem.price)}  = {formatCurrency(returnedItem.total)}</div>
        </div>

        <div className="font-bold border-b border-black mb-1 mt-2">NEW ITEM</div>
        <div className="mb-1">
          <div>{newItem.quantity} x {newItem.name}</div>
          <div>@ {formatCurrency(newItem.price)}  = {formatCurrency(newItem.total)}</div>
        </div>
      </div>

      {!isEven && (
        <div className="border-t border-dashed border-black pt-2 space-y-1">
          <div className="flex justify-between font-bold text-sm border-b border-black pb-1">
            <span>{isUpsell ? 'PAYMENT COLLECTED:' : 'CREDIT TO ACCOUNT:'}</span>
            <span>{formatCurrency(Math.abs(balance))}</span>
          </div>
        </div>
      )}

      <div className="text-center mt-6">
        <div>Exchange Transaction Record</div>
        <div style={{ fontSize: '9px' }}>Printed: {format(new Date(), 'PP p')}</div>
      </div>
    </div>
  );
});

ExchangeSlipView.displayName = 'ExchangeSlipView';
