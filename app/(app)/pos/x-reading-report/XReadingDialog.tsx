'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { ReadingConfirm, guardedSheetProps } from '../reading-confirm/ReadingConfirm';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';
import { XReadingPreview } from '../../sales/x-reading/x-reading-preview';
import { AdminAuthDialog } from '../admin-auth/AdminAuthDialog';
import { useXReadingReport } from './use-x-reading-report';
import type { XReadingDialogProps } from './x-reading-report-types';

export function XReadingDialog({ isOpen, onOpenChange, shiftId, autoShow = false, terminalName, printMode, requireAuth = true, authCredentials }: XReadingDialogProps) {
  const {
    isAuthDialogOpen, setIsAuthDialogOpen,
    showReport,
    reportData, businessSettings, loading,
    isPrinting,
    handlePrint, loadReportData, handleAdminAuthSuccess,
  } = useXReadingReport({ isOpen, shiftId, autoShow, terminalName, printMode, requireAuth });

  const authSucceededRef = useRef(false);
  const [isPrintConfirmOpen, setIsPrintConfirmOpen] = useState(false);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // A prompt left open must not reappear the next time the drawer opens.
    setIsPrintConfirmOpen(false);
    setIsCloseConfirmOpen(false);
  }, [isOpen]);
  const shiftEnded = !!reportData && reportData.shiftStatus !== 'active';

  return (
    <>
      {/* Rendered as a sibling, not nested inside SheetContent: Radix Dialog
          and Sheet share the same portal primitive, and a Dialog portaled
          inside a Sheet's portal content causes the Sheet's outside-click
          detection to treat the nested Dialog as "outside" and dismiss
          itself, closing the report the instant auth succeeds. */}
      <AdminAuthDialog
        isOpen={requireAuth && isAuthDialogOpen}
        requiredCredentials={authCredentials}
        onOpenChange={(open) => {
          setIsAuthDialogOpen(open);
          // useAdminAuth calls onSuccess() then onOpenChange(false) as part
          // of the same authenticate flow; the setShowReport(true) inside
          // handleAdminAuthSuccess hasn't landed in this closure's showReport
          // yet, so without this guard the stale `false` wrongly closes the
          // whole dialog instead of just the auth step.
          if (!open && !showReport && !authSucceededRef.current) onOpenChange(false);
          authSucceededRef.current = false;
        }}
        title="X-Reading Authorization"
        description="Admin password is required to generate the report preview."
        onSuccess={() => { authSucceededRef.current = true; handleAdminAuthSuccess(); }}
      />

      {/* Outside clicks never close the drawer; the back arrow and Escape
          ask first (guardedSheetProps + the Close prompt below). */}
      <Sheet open={isOpen && showReport} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl h-full overflow-hidden flex flex-col p-0 gap-0 [&>button]:hidden"
          {...guardedSheetProps(() => setIsCloseConfirmOpen(true))}
        >
          <SheetHeader className="px-4 py-3 border-b flex-none flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setIsCloseConfirmOpen(true)} className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <SheetTitle>X-READING REPORT</SheetTitle>
            </div>
            <SheetDescription className="hidden">Report Details</SheetDescription>
            <Button size="sm" onClick={() => setIsPrintConfirmOpen(true)} disabled={loading || isPrinting || !reportData || isPrintConfirmOpen}>
              {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              Print
            </Button>
          </SheetHeader>
          <ReadingConfirm
            open={isCloseConfirmOpen}
            icon="close"
            title="Close X-Reading?"
            description="Are you sure you want to close the X-Reading report?"
            yesLabel="Yes, Close"
            noLabel="No"
            onYes={() => { setIsCloseConfirmOpen(false); onOpenChange(false); }}
            onNo={() => setIsCloseConfirmOpen(false)}
          />
          <ReadingConfirm
            open={isPrintConfirmOpen}
            title="Print X-Reading?"
            yesLabel="Yes, Print"
            noLabel="No, Don't Print"
            description={
              // The X-Reading row is written by End Shift (use-pos.ts
              // handleConfirmEndShift), not by this dialog — say which case
              // this is instead of promising a save this button doesn't do.
              shiftEnded ? (
                <>
                  This X-Reading was <span className="font-medium text-foreground">already saved</span> when
                  the shift ended. Choose No to skip printing — you can still print it later from Sales › X-Reading.
                </>
              ) : (
                <>
                  The X-Reading is <span className="font-medium text-foreground">saved automatically when the
                  shift ends</span>. Choose No to skip printing.
                </>
              )
            }
            onYes={() => { setIsPrintConfirmOpen(false); handlePrint(); }}
            onNo={() => {
              setIsPrintConfirmOpen(false);
              toast({ title: 'Not Printed', description: shiftEnded ? 'The X-Reading stays saved; no receipt was printed.' : 'No receipt was printed.' });
            }}
            onCancel={() => setIsPrintConfirmOpen(false)}
          />

          <div className="flex-1 overflow-auto bg-muted/20 p-4 flex justify-center">
            {loading ? (
              <div className="p-8 text-center flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading report...</p>
              </div>
            ) : reportData ? (
              <div className="bg-white shadow-lg h-fit max-w-[400px] w-full">
                <XReadingPreview data={{ ...reportData, terminalName }} businessSettings={businessSettings} printerFormat={businessSettings?.paperSize === '80mm' ? '80mm' : '58mm'} />
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-gray-500">
                <p>No data available.</p>
                <Button onClick={loadReportData} variant="outline" size="sm" className="mt-2 text-foreground">
                  Retry
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
