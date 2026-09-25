'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetFooter } from '@/components/ui/sheet';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { peso } from './return-sales-utils';
import { isExchangeBalanceTender } from '@/lib/pos/exchange-tender';

interface ExchangeBalanceViewProps {
  returnItemLabel: string;
  returnTotal: number;
  newItemLabel: string;
  newTotal: number;
  balance: number; // newTotal - returnTotal
  hasCustomer: boolean;
  paymentMethods: { id: string; name: string; isReferenceRequired?: boolean }[];
  isLoading: boolean;
  onConfirm: (payment?: { method: string; amountTendered: number; reference?: string }) => void;
  onBack: () => void;
}

export function ExchangeBalanceView({
  returnItemLabel, returnTotal, newItemLabel, newTotal, balance,
  hasCustomer, paymentMethods, isLoading, onConfirm, onBack,
}: ExchangeBalanceViewProps) {
  // Spec: the balance is settled by cash or card only, never POINTS / CHARGE /
  // gift checks. The route enforces the same rule (isExchangeBalanceTender);
  // this just keeps the cashier from picking something it would reject.
  const balanceMethods = useMemo(
    () => paymentMethods.filter(m => isExchangeBalanceTender(m.name)),
    [paymentMethods]
  );
  const [method, setMethod] = useState(
    () => balanceMethods.find(m => m.name.trim().toUpperCase() === 'CASH')?.name
      || balanceMethods[0]?.name
      || 'CASH'
  );
  const [amountTendered, setAmountTendered] = useState('');
  const [reference, setReference] = useState('');

  const isEven = Math.abs(balance) < 0.005;
  const isUpsell = balance > 0.005;
  const isDownsell = balance < -0.005;
  const selectedMethod = paymentMethods.find(m => m.name === method);
  const referenceRequired = !!selectedMethod?.isReferenceRequired;

  const tenderedNum = parseFloat(amountTendered) || 0;
  const canConfirm = isEven
    || (isUpsell && tenderedNum >= balance && (!referenceRequired || reference.trim()))
    || (isDownsell && hasCustomer);

  const handleConfirm = () => {
    if (isEven) {
      onConfirm(undefined);
      return;
    }
    if (isUpsell) {
      onConfirm({ method, amountTendered: tenderedNum, reference: reference.trim() || undefined });
      return;
    }
    onConfirm(undefined); // downsell: server credits customer, no payment object needed
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b pb-3">
        <h2 className="text-base font-semibold">Settle Exchange Balance</h2>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between"><span>Returning: {returnItemLabel}</span><span className="font-mono">{peso(returnTotal)}</span></div>
        <div className="flex justify-between"><span>New item: {newItemLabel}</span><span className="font-mono">{peso(newTotal)}</span></div>
        <div className="border-t pt-2 flex justify-between font-bold">
          <span>{isUpsell ? 'Amount Due' : isDownsell ? 'Credit to Customer' : 'Even Exchange'}</span>
          <span className="font-mono">{peso(Math.abs(balance))}</span>
        </div>
      </div>

      {isUpsell && (
        <div className="mt-5 space-y-3">
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {balanceMethods.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Amount Tendered</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={amountTendered}
              onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setAmountTendered(e.target.value); }}
              placeholder={balance.toFixed(2)}
            />
          </div>
          {referenceRequired && (
            <div className="space-y-1.5">
              <Label>Reference Number</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}
          {tenderedNum > balance && (
            <p className="text-sm text-muted-foreground">Change: {peso(tenderedNum - balance)}</p>
          )}
        </div>
      )}

      {isDownsell && !hasCustomer && (
        <p className="mt-5 text-sm text-destructive">
          This sale has no customer attached, so the difference cannot be credited.
          Cancel and use plain "Issue Credit" instead, or attach a customer to the original sale first.
        </p>
      )}

      <SheetFooter className="mt-auto pt-4">
        <Button variant="outline" onClick={onBack} disabled={isLoading}>Back</Button>
        <Button
          className="bg-amber-600 hover:bg-amber-700 text-white"
          disabled={!canConfirm || isLoading}
          onClick={handleConfirm}
        >
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowLeftRight className="mr-2 h-4 w-4" />}
          Confirm Exchange
        </Button>
      </SheetFooter>
    </div>
  );
}
