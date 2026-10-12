'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Percent, Banknote, UserRound, Accessibility, CreditCard, User, ShieldCheck } from 'lucide-react';
import { useDiscount } from './use-discount';
import type { DiscountDialogProps, DiscountType } from './discount-types';

export type { DiscountDetails } from './discount-types';

export function DiscountDialog({ isOpen, onOpenChange, item, onApplyDiscount, hasItems }: DiscountDialogProps) {
  const {
    discountType, setDiscountType,
    scope, setScope,
    value, setValue,
    idNumber, setIdNumber,
    holderName, setHolderName,
    isStatutory, statutoryInvalid,
    handleApply,
  } = useDiscount({ isOpen, item, onApplyDiscount, onOpenChange });

  if (!hasItems) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-[380px] p-0 overflow-hidden border-none shadow-2xl">
        <div className="bg-white dark:bg-slate-900 h-full p-6 space-y-6">
          <SheetHeader className="space-y-3">
            <div className="flex justify-center">
              <div className="bg-blue-50 dark:bg-blue-950/50 p-3 rounded-2xl">
                <Percent className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <SheetTitle className="text-2xl font-extrabold text-center text-slate-800 dark:text-slate-100">
              Discounts
            </SheetTitle>
            <SheetDescription className="sr-only">Apply a discount to the selected item or all cart items</SheetDescription>
            <div className="text-sm text-slate-500 dark:text-slate-400 text-center bg-slate-50 dark:bg-slate-800/60 py-2 px-3 rounded-lg border border-slate-100 dark:border-slate-700 truncate">
              {scope === 'all' ? 'Apply to all items in cart' : `Item: ${item?.name || 'Selected Item'}`}
            </div>
          </SheetHeader>

          <div className="space-y-5">
            {/* Scope Toggle */}
            <div className="flex bg-slate-100/80 dark:bg-slate-800/80 p-1.5 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
              <Button
                type="button"
                variant="ghost"
                className={`flex-1 h-10 text-xs uppercase font-bold tracking-wider transition-all duration-200 rounded-lg ${
                  scope === 'selected'
                    ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400 ring-1 ring-slate-200 dark:ring-slate-600'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
                }`}
                onClick={() => setScope('selected')}
                disabled={!item}
              >
                Selected
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={`flex-1 h-10 text-xs uppercase font-bold tracking-wider transition-all duration-200 rounded-lg ${
                  scope === 'all'
                    ? 'bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400 ring-1 ring-slate-200 dark:ring-slate-600'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-slate-700/50'
                }`}
                onClick={() => { setScope('all'); setDiscountType('percent'); }}
              >
                All Items
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-tight ml-1">Discount Type</Label>
              <Select
                value={discountType}
                onValueChange={(val: DiscountType) => {
                  setDiscountType(val);
                  if (val === 'pwd' || val === 'senior' || val === 'naac') {
                    setValue('20');
                  } else if (val === 'solo_parent') {
                    setValue('10');
                  } else if (val === 'percent' && item && (discountType === 'pwd' || discountType === 'senior' || discountType === 'naac' || discountType === 'solo_parent')) {
                    setValue(item.discount ? item.discount.toString() : '');
                  }
                }}
              >
                <SelectTrigger className="w-full h-12 border-slate-200 dark:border-slate-700 rounded-xl focus:ring-blue-500 bg-slate-50/30 dark:bg-slate-800/50">
                  <SelectValue placeholder="Select discount type" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200 dark:border-slate-700 shadow-xl">
                  <SelectItem value="percent" className="rounded-lg">
                    <div className="flex items-center gap-3 py-1">
                      <div className="bg-blue-100 dark:bg-blue-950/60 p-1.5 rounded-md"><Percent className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                      <span className="font-medium text-slate-700 dark:text-slate-200">Percentage (%)</span>
                    </div>
                  </SelectItem>
                  {scope === 'selected' && (
                    <SelectItem value="amount" className="rounded-lg">
                      <div className="flex items-center gap-3 py-1">
                        <div className="bg-green-100 dark:bg-green-950/60 p-1.5 rounded-md"><Banknote className="w-4 h-4 text-green-600 dark:text-green-400" /></div>
                        <span className="font-medium text-slate-700 dark:text-slate-200">Fixed Amount (₱)</span>
                      </div>
                    </SelectItem>
                  )}
                  <SelectItem value="senior" className="rounded-lg">
                    <div className="flex items-center gap-3 py-1">
                      <div className="bg-orange-100 dark:bg-orange-950/60 p-1.5 rounded-md"><UserRound className="w-4 h-4 text-orange-600 dark:text-orange-400" /></div>
                      <span className="font-medium text-slate-700 dark:text-slate-200">Senior Citizen (20%)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="pwd" className="rounded-lg">
                    <div className="flex items-center gap-3 py-1">
                      <div className="bg-purple-100 dark:bg-purple-950/60 p-1.5 rounded-md"><Accessibility className="w-4 h-4 text-purple-600 dark:text-purple-400" /></div>
                      <span className="font-medium text-slate-700 dark:text-slate-200">PWD Discount (20%)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="naac" className="rounded-lg">
                    <div className="flex items-center gap-3 py-1">
                      <div className="bg-teal-100 dark:bg-teal-950/60 p-1.5 rounded-md"><UserRound className="w-4 h-4 text-teal-600 dark:text-teal-400" /></div>
                      <span className="font-medium text-slate-700 dark:text-slate-200">NAAC Discount (20%)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="solo_parent" className="rounded-lg">
                    <div className="flex items-center gap-3 py-1">
                      <div className="bg-pink-100 dark:bg-pink-950/60 p-1.5 rounded-md"><UserRound className="w-4 h-4 text-pink-600 dark:text-pink-400" /></div>
                      <span className="font-medium text-slate-700 dark:text-slate-200">Solo Parent Discount (10%)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-tight ml-1">
                {['pwd', 'senior', 'naac', 'solo_parent'].includes(discountType) ? 'Fixed Rate' : 'Value to Subtract'}
              </Label>
              <div className="relative group">
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  className={`text-center text-3xl font-black h-20 border-2 rounded-2xl transition-all duration-200 focus-visible:ring-blue-500 focus:border-blue-500 ${
                    ['pwd', 'senior', 'naac', 'solo_parent'].includes(discountType)
                      ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                  readOnly={['pwd', 'senior', 'naac', 'solo_parent'].includes(discountType)}
                  autoFocus={!['pwd', 'senior', 'naac', 'solo_parent'].includes(discountType)}
                  onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                />
                <div className={`absolute left-6 top-1/2 -translate-y-1/2 font-bold text-2xl transition-colors duration-200 ${
                  ['pwd', 'senior', 'naac', 'solo_parent'].includes(discountType) ? 'text-slate-300 dark:text-slate-600' : 'text-blue-600 dark:text-blue-400'
                }`}>
                  {discountType === 'amount' ? '₱' : '%'}
                </div>
              </div>
            </div>

            {isStatutory && (
              <div className="space-y-3 rounded-2xl border border-blue-100 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" /> ID Verification Required
                </p>
                <div className="space-y-2">
                  <Label htmlFor="discount-id-number" className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-tight ml-1">ID Number</Label>
                  <div className="relative">
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                    <Input
                      id="discount-id-number"
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      placeholder="e.g. OSCA / PWD ID No."
                      className="h-11 pl-9 rounded-xl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="discount-holder-name" className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-tight ml-1">Cardholder Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
                    <Input
                      id="discount-holder-name"
                      value={holderName}
                      onChange={(e) => setHolderName(e.target.value)}
                      placeholder="Full name on ID"
                      className="h-11 pl-9 rounded-xl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      onKeyDown={(e) => e.key === 'Enter' && handleApply()}
                    />
                  </div>
                </div>
                {statutoryInvalid && (
                  <p className="text-[11px] font-medium text-red-500 dark:text-red-400 ml-1">
                    ID number and cardholder name are required for this discount.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 h-12 rounded-xl font-bold text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 h-12 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30 transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              onClick={handleApply}
              disabled={statutoryInvalid}
            >
              Apply Discount
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
