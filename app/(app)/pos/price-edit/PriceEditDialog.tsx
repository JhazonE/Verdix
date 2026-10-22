'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tag } from 'lucide-react';
import { usePriceEdit } from './use-price-edit';
import type { PriceEditDialogProps } from './price-edit-types';

export function PriceEditDialog({
  isOpen,
  onOpenChange,
  item,
  onUpdate,
  priceLevels,
  showPriceLevelPicker,
}: PriceEditDialogProps) {
  const {
    price, setPrice, save,
    pickedLevelId, pickLevel, levelOptions, canPickLevel,
    cursorIndex, moveCursor,
  } = usePriceEdit({
    isOpen,
    item,
    onOpenChange,
    onUpdate,
    priceLevels,
    showPriceLevelPicker,
  });

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden border-none shadow-2xl sm:max-w-[400px]">
        <div className="bg-white dark:bg-slate-900 p-6 space-y-6">
          <DialogHeader className="space-y-3">
            <div className="flex justify-center">
              <div className="bg-purple-50 dark:bg-purple-500/15 p-3 rounded-2xl">
                <Tag className="w-8 h-8 text-purple-600 dark:text-purple-300" />
              </div>
            </div>
            <DialogTitle className="text-2xl font-extrabold text-center text-slate-800 dark:text-slate-100">
              Edit Unit Price
            </DialogTitle>
            <DialogDescription className="sr-only">Enter a temporary price override for the selected item</DialogDescription>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center px-4">
              Enter a temporary price for <span className="font-bold text-slate-700 dark:text-slate-200">{item.name}</span>
            </p>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-purple-300 dark:text-purple-400">₱</span>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      save();
                      return;
                    }
                    // Left/Right walk the price levels without the input ever
                    // losing focus, so Enter keeps saving and typing a manual
                    // price stays available at all times. Up/Down are left to
                    // the number input's own spinner.
                    //
                    // The arrows only take over once the caret has nowhere left
                    // to go in that direction, the way a list inside a text box
                    // normally behaves: editing a typed price still moves the
                    // caret, and only an arrow at the edge reaches the levels.
                    // A number input reports null selection in some browsers,
                    // which counts as "nothing to move past".
                    if (canPickLevel && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                      const input = e.currentTarget;
                      // Reading a selection off a number input is not allowed
                      // everywhere — it returns null in Chrome and throws in
                      // some others — so a failure means "no caret to move".
                      let start: number | null = null;
                      let end: number | null = null;
                      try {
                        start = input.selectionStart;
                        end = input.selectionEnd;
                      } catch {
                        // falls through to the edge case below
                      }
                      const hasCaret = start !== null && end !== null && start === end;
                      const atEdge = !hasCaret || (
                        e.key === 'ArrowLeft' ? start === 0 : start === input.value.length
                      );
                      if (atEdge) {
                        e.preventDefault();
                        moveCursor(e.key === 'ArrowRight' ? 1 : -1);
                      }
                    }
                  }}
                  className="font-black focus-visible:ring-purple-500 !text-[60px] h-20 px-4 text-center leading-none bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 dark:text-slate-100 rounded-2xl focus:bg-white dark:focus:bg-slate-800 transition-colors"
                  autoFocus
                />
              </div>
              
              {canPickLevel && (
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight px-2">Price Level</span>
                  <div className="grid grid-cols-2 gap-2">
                    {levelOptions.map((level, index) => {
                      const isPicked = level.id === pickedLevelId;
                      // The arrow-key cursor. It rides along with the pick, so
                      // it only ever adds a ring to the level already chosen —
                      // it never points somewhere the price box disagrees with.
                      const isCursor = index === cursorIndex;
                      return (
                        <button
                          key={level.id}
                          type="button"
                          /* Not focusable by Tab: the price input keeps the
                             keyboard, so Enter still saves without the cashier
                             tabbing past a grid of levels first. Left/Right on
                             that input drive this grid instead. */
                          tabIndex={-1}
                          onClick={() => pickLevel(level.id)}
                          className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                            isPicked
                              ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/40'
                              : 'border-slate-200 hover:bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:border-slate-500'
                          } ${
                            isCursor
                              ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-white dark:ring-purple-400 dark:ring-offset-slate-900'
                              : ''
                          }`}
                        >
                          <span className={`text-xs font-bold truncate w-full ${isPicked ? 'text-purple-700 dark:text-purple-300' : 'text-slate-600 dark:text-slate-300'}`}>
                            {level.name}
                          </span>
                          <span className={`font-mono text-sm font-bold ${isPicked ? 'text-purple-700 dark:text-purple-300' : 'text-slate-700 dark:text-slate-200'}`}>
                            ₱{level.price.toFixed(2)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 px-2">
                    <kbd className="font-sans font-bold">←</kbd>{' '}
                    <kbd className="font-sans font-bold">→</kbd> to switch levels.
                    Applies at any quantity. You can still type a different price.
                  </p>
                </div>
              )}

              <div className="flex justify-between items-center text-xs px-2">
                <span className="font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight">Original Price</span>
                <span className="font-mono font-bold text-slate-700 dark:text-slate-200">₱{item.price.toFixed(2)}</span>
              </div>
            </div>
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
              className="flex-1 h-12 rounded-xl font-bold text-white shadow-lg transition-all active:scale-[0.98] bg-purple-600 hover:bg-purple-700 shadow-purple-200/50 dark:shadow-purple-900/40"
              onClick={save}
            >
              Update Price
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


