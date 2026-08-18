'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Banknote, Coins, CheckCircle2, AlertTriangle, Calculator, FileText, ArrowRight } from 'lucide-react';
import { billDenominations, coinDenominations } from './end-shift-types';
import { DenominationInput } from './DenominationInput';
import { useEndShift } from './use-end-shift';
import type { EndShiftDialogProps } from './end-shift-types';

const fmt = (n: number) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2 }).format(n);

export function EndShiftDialog({ isOpen, onOpenChange, onShiftEnd, startingCash, cashSales, otherPaymentMethods = [], membershipCash = 0, cashIn = 0, cashOut = 0 }: EndShiftDialogProps) {
  const { counts, countedCash, expectedCash, variance, handleCountChange, handleEndShift } =
    useEndShift({ isOpen, onShiftEnd, startingCash, cashSales, membershipCash, cashIn, cashOut });

  const otherPaymentMethodsTotal = otherPaymentMethods.reduce((acc, pm) => acc + pm.amount, 0);
  const totalSales = cashSales + otherPaymentMethodsTotal;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="top" className="h-screen w-full flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 py-4 border-b text-left space-y-0">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Calculator className="h-5 w-5" />
            </div>
            <div className="space-y-0.5">
              <SheetTitle className="text-lg font-bold">End Current Shift</SheetTitle>
              <SheetDescription>
                Count the cash in your drawer and confirm the totals to end your shift.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-hidden px-6 py-5 grid lg:grid-cols-5 gap-6">
          {/* Cash Drawer Count */}
          <div className="lg:col-span-3 flex flex-col min-h-0 space-y-3">
            <div className="flex items-center justify-between px-1 shrink-0">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-slate-700 dark:text-slate-200">Cash Drawer Count</h3>
              </div>
              <span className="rounded-full bg-slate-900 dark:bg-slate-700 px-3 py-1 text-xs font-bold font-mono text-white tabular-nums shadow-sm">
                ₱{fmt(countedCash)}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border bg-slate-50/60 dark:bg-slate-800/40 p-4 space-y-5">
              <section className="space-y-2">
                <div className="flex items-center gap-2 mb-1 text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1">
                  <Banknote className="w-3.5 h-3.5 text-emerald-500" /> Bills
                </div>
                <div className="space-y-2">
                  {billDenominations.map(denom => (
                    <DenominationInput
                      key={denom.value}
                      denom={denom}
                      color="bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900"
                      count={counts[denom.value]}
                      onCountChange={handleCountChange}
                    />
                  ))}
                </div>
              </section>

              <Separator />

              <section className="space-y-2">
                <div className="flex items-center gap-2 mb-1 text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1">
                  <Coins className="w-3.5 h-3.5 text-amber-500" /> Coins
                </div>
                <div className="space-y-2">
                  {coinDenominations.map(denom => (
                    <DenominationInput
                      key={denom.value}
                      denom={denom}
                      color="bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900"
                      count={counts[denom.value]}
                      onCountChange={handleCountChange}
                    />
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* Shift Settlement */}
          <div className="lg:col-span-2 flex flex-col min-h-0 overflow-y-auto space-y-4">
            <div className="flex items-center gap-2 px-1">
              <FileText className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-slate-700 dark:text-slate-200 text-lg">Shift Settlement</h3>
            </div>

            <div className="space-y-0 relative overflow-hidden rounded-2xl border shadow-sm bg-white dark:bg-slate-800/60 pt-2">
              <div className="px-6 py-4 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400 text-sm">Beginning Balance</span>
                  <span className="font-mono font-medium dark:text-slate-100">₱{fmt(startingCash)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400 text-sm">Cash Sales</span>
                  <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">+₱{fmt(cashSales)}</span>
                </div>
                {membershipCash > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-slate-400 text-sm">Membership Fees (cash)</span>
                    <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">+₱{fmt(membershipCash)}</span>
                  </div>
                )}
                {(cashIn > 0 || cashOut > 0) && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 dark:text-slate-400 text-sm">Cash Deposits (In)</span>
                      <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">+₱{fmt(cashIn)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 dark:text-slate-400 text-sm">Cash Pickups (Out)</span>
                      <span className="font-mono font-medium text-red-600 dark:text-red-400">-₱{fmt(cashOut)}</span>
                    </div>
                  </>
                )}

                <Separator className="bg-slate-100 dark:bg-slate-700" />

                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-800 dark:text-slate-100 font-bold uppercase text-xs tracking-widest">Expected Transfer</span>
                  <span className="text-lg font-black font-mono">₱{fmt(expectedCash)}</span>
                </div>

                {otherPaymentMethods.length > 0 && (
                  <>
                    <Separator className="bg-slate-100 dark:bg-slate-700" />
                    <div className="space-y-2">
                      <span className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-widest">
                        Other Payment Methods
                      </span>
                      {otherPaymentMethods.map(pm => (
                        <div key={pm.name} className="flex justify-between items-center">
                          <span className="text-slate-500 dark:text-slate-400 text-sm">{pm.name}</span>
                          <span className="font-mono font-medium dark:text-slate-100">₱{fmt(pm.amount)}</span>
                        </div>
                      ))}
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                        Reference only — not physical cash, so not part of the drawer count below.
                      </p>
                    </div>
                  </>
                )}

                <Separator className="bg-slate-100 dark:bg-slate-700" />

                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-800 dark:text-slate-100 font-bold uppercase text-xs tracking-widest">Total Sales (All Methods)</span>
                  <span className="text-base font-black font-mono dark:text-slate-100">₱{fmt(totalSales)}</span>
                </div>

                <div className="rounded-xl bg-slate-900 text-slate-50 p-5 mt-2 shadow-lg">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Actual Counted</span>
                    <CheckCircle2 className={`w-4 h-4 ${variance === 0 ? 'text-emerald-400' : 'text-slate-600'}`} />
                  </div>
                  <div className="text-3xl font-black font-mono tracking-tighter">
                    ₱{fmt(countedCash)}
                  </div>
                </div>
              </div>

              <div className={`p-4 mt-2 border-t ${
                Math.round(variance * 100) === 0 ? 'bg-emerald-50 text-emerald-800 border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900' :
                variance > 0 ? 'bg-blue-50 text-blue-800 border-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900' :
                'bg-red-50 text-red-800 border-red-100 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
              }`}>
                <div className="flex items-center justify-center gap-3">
                  {Math.round(variance * 100) === 0 ? (
                    <>
                      <CheckCircle2 className="w-6 h-6" />
                      <span className="font-black uppercase tracking-widest">Perfect Balance</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-6 h-6" />
                      <div className="text-center">
                        <div className="font-black uppercase tracking-tight leading-none">
                          {variance > 0 ? 'Cash Overage' : 'Cash Shortage'}
                        </div>
                        <div className="font-mono text-xl font-black">
                          ₱{fmt(Math.abs(variance))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
              <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 italic">
                <ArrowRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <p>Total counted cash will be transferred to the main vault upon submission. Please re-verify any shortage exceeding ₱50.00.</p>
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="px-6 py-4 border-t bg-background gap-2 sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleEndShift} variant="destructive">
            Confirm and End Shift
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
