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
import { Tag } from 'lucide-react';
import { useSuspendNote } from './use-suspend-note';
import type { SuspendNoteDialogProps } from './suspend-note-types';

export function SuspendNoteDialog({
  isOpen,
  onOpenChange,
  onConfirm,
}: SuspendNoteDialogProps) {
  const { note, setNote, handleConfirm } = useSuspendNote({
    isOpen,
    onOpenChange,
    onConfirm,
  });

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-[400px] p-0 overflow-hidden border-none shadow-2xl">
        <div className="bg-white dark:bg-slate-900 p-6 space-y-6">
          <SheetHeader className="space-y-3">
            <div className="flex justify-center">
              <div className="bg-orange-50 p-3 rounded-2xl">
                <Tag className="w-8 h-8 text-orange-600" />
              </div>
            </div>
            <SheetTitle className="text-2xl font-extrabold text-center text-slate-800 dark:text-slate-100">
              Suspend Transaction
            </SheetTitle>
            <SheetDescription className="sr-only">Add a note to identify this suspended transaction later</SheetDescription>
            <p className="text-sm text-slate-500 text-center px-4">
              Add a note or description to identify this transaction later.
            </p>
          </SheetHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-600 uppercase tracking-tight ml-1">
                Note / Description
              </Label>
              <Input
                autoFocus
                placeholder="e.g. Waiting for wallet, Customer name..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirm();
                }}
                className="h-12 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:ring-orange-500 rounded-xl px-4"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button 
              variant="outline" 
              className="flex-1 h-12 rounded-xl font-bold text-slate-600 border-slate-200 hover:bg-slate-50 dark:hover:bg-orange-500/15 dark:hover:text-orange-400 dark:hover:border-orange-500 transition-colors"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button 
              className="flex-1 h-12 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-lg shadow-orange-200/50 transition-all active:scale-[0.98]"
              onClick={handleConfirm}
            >
              Suspend
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
