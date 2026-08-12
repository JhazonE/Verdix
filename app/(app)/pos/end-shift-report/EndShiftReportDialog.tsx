'use client';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Files, Receipt, BookOpen } from 'lucide-react';
import type { EndShiftReportDialogProps } from './end-shift-report-types';

export function EndShiftReportDialog({
  open,
  onOpenChange,
  onOpenOverallReading,
  onOpenXReading,
  onOpenZReadingWarning,
}: EndShiftReportDialogProps) {
  const openThen = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="space-y-0.5">
              <AlertDialogTitle>Shift Ended Successfully</AlertDialogTitle>
              <AlertDialogDescription>
                Choose a report to view, or close this and view them later from the footer actions.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="grid grid-cols-3 gap-3 py-2">
          <Button type="button" variant="outline" className="h-auto flex-col gap-2 py-4" onClick={openThen(onOpenOverallReading)}>
            <Files className="h-5 w-5 text-purple-600" />
            <span className="text-xs font-semibold">Overall</span>
          </Button>
          <Button type="button" variant="outline" className="h-auto flex-col gap-2 py-4" onClick={openThen(onOpenXReading)}>
            <Receipt className="h-5 w-5 text-purple-600" />
            <span className="text-xs font-semibold">X-Reading</span>
          </Button>
          <Button type="button" variant="outline" className="h-auto flex-col gap-2 py-4" onClick={openThen(onOpenZReadingWarning)}>
            <BookOpen className="h-5 w-5 text-purple-600" />
            <span className="text-xs font-semibold">Z-Reading</span>
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
