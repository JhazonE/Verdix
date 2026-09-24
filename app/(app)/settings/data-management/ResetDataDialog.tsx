'use client';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, HardDrive, RefreshCw } from 'lucide-react';
import type { ResetAction } from './data-management-types';

const RESET_DESCRIPTIONS: Record<ResetAction, string> = {
  clear_sales: 'This will permanently delete all sales history, purchase orders, shift records, and transaction logs including approval items related to sales.',
  reset_references: 'This will reset all transaction counters and terminal OR numbers. This may cause collision if you have existing records.',
  clear_inventory: 'This will permanently delete ALL products, stock movements, transfers, and warehouse management data.',
  clear_master_data: 'This will permanently delete all customer and supplier records, product categories, and brand definitions.',
  factory_reset: 'CRITICAL: This will wipe the ENTIRE database (Transactions, Products, Customers, Suppliers, etc.). This action is IRREVERSIBLE.',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resetAction: ResetAction | null;
  confirmText: string;
  onConfirmTextChange: (v: string) => void;
  resetWithBackup: boolean;
  onResetWithBackupChange: (v: boolean) => void;
  loading: boolean;
  onConfirm: () => void;
}

export function ResetDataDialog({ open, onOpenChange, resetAction, confirmText, onConfirmTextChange, resetWithBackup, onResetWithBackupChange, loading, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md p-6">
        <AlertDialogHeader className="pb-2">
          <AlertDialogTitle className="text-destructive flex items-center gap-2 text-xl">
            <AlertCircle className="h-6 w-6" />
            Confirm Destructive Action
          </AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground/90 font-medium pt-1">
            {resetAction ? RESET_DESCRIPTIONS[resetAction] : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-6 space-y-3 border-y border-red-100/50 my-2">
          <div className="flex items-center justify-between bg-orange-50 dark:bg-orange-950/20 p-3 rounded-lg border border-orange-200 mb-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-orange-600" />
              <Label htmlFor="reset-backup" className="text-sm font-semibold text-orange-800 dark:text-orange-300">
                Create backup before reset
              </Label>
            </div>
            <Switch id="reset-backup" checked={resetWithBackup} onCheckedChange={onResetWithBackupChange} />
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            This action is <span className="font-bold text-destructive uppercase">irreversible</span> and cannot be undone.
            Please type <span className="font-bold text-destructive underline">CONFIRM</span> below to verify.
          </p>
          <Input
            id="confirm-text"
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            placeholder="Type CONFIRM here"
            className="h-12 border-destructive/30 focus-visible:ring-destructive bg-destructive/5 text-lg font-semibold text-center tracking-widest"
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter className="pt-4 gap-2">
          <AlertDialogCancel className="font-semibold mt-0">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold px-8"
            onClick={onConfirm}
            disabled={confirmText !== 'CONFIRM' || loading}
          >
            {loading ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Resetting...</> : 'Confirm Reset'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
