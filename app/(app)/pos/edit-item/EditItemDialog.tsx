'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tag, Pencil } from 'lucide-react';
import { useEditItem } from './use-edit-item';
import type { EditItemDialogProps } from './edit-item-types';

export function EditItemDialog({ isOpen, onOpenChange, item, onUpdate, mode = 'full', activeLevelId, defaultLevelId = 'retail-level', product }: EditItemDialogProps) {
  const { name, setName, quantity, price, setPrice, discount, handleQuantityChange, save } =
    useEditItem({ isOpen, item, onUpdate, onOpenChange, activeLevelId, defaultLevelId, product });

  if (!item) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={`p-0 overflow-hidden border-none shadow-2xl ${mode === 'price-only' ? 'sm:max-w-[400px]' : 'sm:max-w-md'}`}>
        <div className="bg-white dark:bg-slate-900 p-6 space-y-6">
          <SheetHeader className="space-y-3">
            <div className="flex justify-center">
              <div className={`${mode === 'price-only' ? 'bg-purple-50' : 'bg-blue-50'} p-3 rounded-2xl`}>
                {mode === 'price-only'
                  ? <Tag className="w-8 h-8 text-purple-600" />
                  : <Pencil className="w-8 h-8 text-blue-600" />}
              </div>
            </div>
            <SheetTitle className="text-2xl font-extrabold text-center text-slate-800 dark:text-slate-100">
              {mode === 'price-only' ? 'Edit Unit Price' : 'Edit Item Details'}
            </SheetTitle>
            <p className="text-sm text-slate-500 text-center px-4">
              {mode === 'price-only'
                ? `Enter a temporary price for ${item.name}`
                : 'Temporary changes for this transaction only.'}
            </p>
          </SheetHeader>

          <div className="space-y-4">
            {mode === 'price-only' ? (
              <div className="space-y-3">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-purple-300">₱</span>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
                    className="font-black focus-visible:ring-purple-500 text-[32px] h-20 pl-10 pr-4 text-right leading-none bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-100 rounded-2xl focus:bg-white dark:focus:bg-slate-800 transition-colors"
                    autoFocus
                  />
                </div>
                <div className="flex justify-between items-center text-xs px-2">
                  <span className="font-bold text-slate-500 uppercase tracking-tight">Original Price</span>
                  <span className="font-mono font-bold text-slate-700">₱{item.price.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-bold text-slate-600 uppercase tracking-tight ml-1">Item Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
                    className="font-medium focus-visible:ring-blue-500 h-12 bg-slate-50 border-slate-200 rounded-xl px-4"
                    placeholder="Enter new item name"
                    autoFocus
                  />
                  <p className="text-xs text-slate-400 italic ml-1">Original: {item.name}</p>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-100">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-500">Unit Price:</span>
                    <span className="font-mono font-bold text-slate-700">₱{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-500">Quantity:</span>
                    <span className="font-mono font-bold text-slate-700">{quantity}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="font-bold text-slate-500">Discount:</span>
                      <span className="font-mono font-bold text-green-600">{discount}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 h-12 rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className={`flex-1 h-12 rounded-xl font-bold text-white shadow-lg transition-all active:scale-[0.98] ${
                mode === 'price-only'
                  ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200/50'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200/50'
              }`}
              onClick={save}
            >
              {mode === 'price-only' ? 'Update Price' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
