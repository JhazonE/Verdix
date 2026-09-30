'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { VoidLineChoiceDialogProps } from './void-line-choice-types';

export function VoidLineChoiceDialog({
  open,
  onOpenChange,
  onChoose,
  selectedItemName,
  itemCount,
}: VoidLineChoiceDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void Line</AlertDialogTitle>
          <AlertDialogDescription>
            Void just the selected item{selectedItemName ? ` (${selectedItemName})` : ''}, or clear all {itemCount} {itemCount === 1 ? 'item' : 'items'} from the cart?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onChoose('selected')} disabled={!selectedItemName}>
            Void Selected Item
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => onChoose('all')}
            className={cn(buttonVariants({ variant: 'destructive' }))}
          >
            Void All Items
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
