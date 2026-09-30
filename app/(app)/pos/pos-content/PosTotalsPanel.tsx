'use client';

import { Button } from '@/components/ui/button';
import { ShoppingCart, User, X, ChevronRight, SendToBack } from 'lucide-react';
import { WALK_IN_CUSTOMER } from '../customer-account/CustomerAccountDialog';
import type { SaleItem } from './pos-types';
import type { Customer, SystemSettings } from '@/lib/types';

type TaxDetails = {
  vatSales: number;
  vatAmount: number;
  nonVatSales: number;
  zeroRatedSales: number;
  vatExemptSales: number;
  subTotal: number;
};

type Props = {
  businessSettings: SystemSettings | null;
  currentTerminalName: string;
  currentUser: any;
  selectedCustomer: Customer | null;
  handleSelectCustomer: (c: Customer | null) => void;
  setIsCustomerSelectOpen: (v: boolean) => void;
  totalDue: number;
  numberOfItems: number;
  subTotal: number;
  vatSales: number;
  vatAmount: number;
  taxDetails: TaxDetails;
  items: SaleItem[];
  handleDefaultTender: () => void;
  isFrontliner?: boolean;
  handleSendToQueue?: () => void;
  posMode?: 'default' | 'pharmacy';
  editingQueueOrder?: { dailyQueueNumber: number } | null;
};

export function PosTotalsPanel({
  businessSettings, currentTerminalName, currentUser,
  selectedCustomer, handleSelectCustomer, setIsCustomerSelectOpen,
  totalDue, numberOfItems, subTotal, vatSales, vatAmount, taxDetails,
  items, handleDefaultTender, isFrontliner, handleSendToQueue, posMode,
  editingQueueOrder,
}: Props) {
  return (
    <div className="w-96 bg-background border-l shadow-2xl z-20 flex flex-col h-full">
      {/* Branded Header */}
      <div className={`text-white px-5 py-4 shadow-[0_10px_25px_-5px_hsl(var(--primary)/0.4)] ${isFrontliner ? 'bg-gradient-to-br from-violet-700 to-violet-600' : 'bg-gradient-to-br from-primary to-primary/85'}`}>
        <div className="flex items-center gap-3">
          {businessSettings?.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={businessSettings.logoPath} alt="Business Logo" className="w-11 h-11 rounded-lg object-contain bg-white/15 p-1 shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
              <ShoppingCart className="w-6 h-6" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xl font-black uppercase tracking-wide leading-none truncate drop-shadow-sm">{businessSettings?.businessName || 'Vendix'}</p>
            <p className="text-[11px] text-white/70 mt-1 font-mono truncate">{currentTerminalName}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2.5 bg-white/10 rounded-lg px-3 py-2 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <User className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-white/60 leading-none">
              {isFrontliner ? 'Frontliner' : 'Cashier'}
            </p>
            <p className="font-bold text-sm leading-none mt-1 truncate">{currentUser?.displayName || (isFrontliner ? 'Frontliner' : 'Cashier Terminal')}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {posMode === 'pharmacy' && (
              <span className="rounded-md bg-cyan-500/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                Ordering
              </span>
            )}
            {isFrontliner && (
              <span className="rounded-md bg-white/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                Frontliner
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Customer selector */}
      <div className="px-4 pt-4 pb-3 border-b bg-muted/10">
        <button
          type="button"
          onClick={() => setIsCustomerSelectOpen(true)}
          className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-950">
            <User className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Customer</p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">{selectedCustomer?.name || 'Walk-in Customer'}</p>
          </div>
          {selectedCustomer?.id !== 'walk-in' ? (
            <span
              role="button"
              tabIndex={0}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
              title="Reset to Walk-in"
              onClick={(e) => { e.stopPropagation(); handleSelectCustomer(WALK_IN_CUSTOMER); }}
            >
              <X className="h-4 w-4" />
            </span>
          ) : (
            <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono font-semibold text-muted-foreground">Ctrl+3</kbd>
          )}
        </button>
      </div>

      {/* Total Amount Due */}
      <div className="px-6 py-6 text-center border-b bg-muted/20 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
        <span className="relative text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Total Amount</span>
        <div className="relative flex items-start justify-center mt-1.5">
          <span className="text-3xl font-bold text-primary mt-2 mr-1">₱</span>
          <span className="text-6xl font-black tracking-tighter text-primary tabular-nums leading-none">
            {totalDue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </span>
        </div>
        <p className="relative text-xs text-muted-foreground mt-2 font-medium">
          {numberOfItems} {numberOfItems === 1 ? 'item' : 'items'} in cart
        </p>
      </div>

      {/* Breakdown */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        <div className="space-y-2.5">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono font-semibold tabular-nums">₱{subTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Discount</span>
            <span className="font-mono font-semibold tabular-nums text-rose-600">
              −₱{(items.reduce((acc, item) => acc + item.price * item.quantity, 0) - totalDue).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex justify-between items-center pt-0.5">
            <span className="text-sm font-bold uppercase tracking-wide text-foreground">Amount Due</span>
            <span className="font-mono font-black text-lg text-primary tabular-nums">₱{totalDue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        <div className="space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tax Breakdown</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'VATable Sales', value: vatSales },
              { label: 'VAT Amount', value: vatAmount },
              { label: 'VAT-Exempt', value: taxDetails.vatExemptSales },
              { label: 'Zero-Rated', value: taxDetails.zeroRatedSales },
              { label: 'Non-VAT Sales', value: taxDetails.nonVatSales },
            ].map(stat => (
              <div key={stat.label} className="rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">{stat.label}</p>
                <p className="font-mono font-semibold text-sm text-foreground tabular-nums mt-1">
                  ₱{stat.value.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Button */}
      <div className="p-5 bg-muted/10 border-t space-y-2">
        {isFrontliner && editingQueueOrder && (
          <div className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            Editing Order #{String(editingQueueOrder.dailyQueueNumber).padStart(3, '0')} — will keep the same number
          </div>
        )}
        {isFrontliner ? (
          <Button
            size="lg"
            className="w-full h-20 text-2xl font-bold shadow-lg bg-violet-600 hover:bg-violet-700 shadow-violet-400/20 hover:shadow-violet-400/40 hover:-translate-y-1 transition-all rounded-xl"
            onClick={handleSendToQueue}
            disabled={items.length === 0}
          >
            <span className="flex-1 text-left pl-4">{editingQueueOrder ? 'RESEND TO QUEUE' : 'SEND TO QUEUE'}</span>
            <div className="bg-white/20 rounded-lg p-2 mr-2">
              <SendToBack className="w-8 h-8" />
            </div>
          </Button>
        ) : (
          <Button
            size="lg"
            className="w-full h-20 text-2xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-1 transition-all rounded-xl"
            onClick={handleDefaultTender}
            disabled={items.length === 0}
          >
            <span className="flex-1 text-left pl-4">TENDER</span>
            <div className="bg-white/20 rounded-lg p-2 mr-2">
              <ChevronRight className="w-8 h-8" />
            </div>
          </Button>
        )}
      </div>
    </div>
  );
}
