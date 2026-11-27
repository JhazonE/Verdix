'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { OverallReadingPreview } from '../../sales/overall-reading/overall-reading-preview';
import { useOverallReading } from './use-overall-reading';
import { ReadingConfirm, guardedSheetProps } from '../reading-confirm/ReadingConfirm';
import type { OverallReadingDialogProps } from './overall-reading-types';

export function OverallReadingDialog({ isOpen, onOpenChange, terminalId, terminalName, printMode }: OverallReadingDialogProps) {
  const { reportData, loading, isPrinting, handlePrint, loadReportData, paperSize } = useOverallReading({
    isOpen, terminalId, terminalName, printMode,
  });
  const [isPrintConfirmOpen, setIsPrintConfirmOpen] = useState(false);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // A prompt left open must not reappear the next time the drawer opens.
    setIsPrintConfirmOpen(false);
    setIsCloseConfirmOpen(false);
  }, [isOpen]);

  return (
    // Outside clicks never close the drawer; the back arrow and Escape ask
    // first (guardedSheetProps + the Close prompt below).
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
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
            <SheetTitle>OVERALL TERMINAL READING</SheetTitle>
          </div>
          <Button size="sm" onClick={() => setIsPrintConfirmOpen(true)} disabled={loading || isPrinting || !reportData || isPrintConfirmOpen}>
            {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Print
          </Button>
        </SheetHeader>

        <ReadingConfirm
          open={isPrintConfirmOpen}
          title="Print Overall Reading?"
          // The Overall Reading has no table of its own — it is a live
          // summary since the last Z-Reading, so there is nothing to save.
          description="Choose No to skip printing. The Overall Reading is a live summary since the last Z-Reading, so you can open and print it again any time."
          yesLabel="Yes, Print"
          noLabel="No, Don't Print"
          onYes={() => { setIsPrintConfirmOpen(false); handlePrint(); }}
          onNo={() => { setIsPrintConfirmOpen(false); toast({ title: 'Not Printed', description: 'No receipt was printed.' }); }}
          onCancel={() => setIsPrintConfirmOpen(false)}
        />
        <ReadingConfirm
          open={isCloseConfirmOpen}
          icon="close"
          title="Close Overall Reading?"
          description="Are you sure you want to close the Overall Reading report?"
          yesLabel="Yes, Close"
          noLabel="No"
          onYes={() => { setIsCloseConfirmOpen(false); onOpenChange(false); }}
          onNo={() => setIsCloseConfirmOpen(false)}
        />

        <div className="flex-1 overflow-auto bg-muted/20 p-4 flex justify-center">
          {loading ? (
            <div className="p-8 text-center flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating overall reading...</p>
            </div>
          ) : reportData ? (
            <div className={`bg-white shadow-lg h-fit w-full ${paperSize === '80mm' ? 'max-w-[400px]' : 'max-w-[280px]'}`}>
              <OverallReadingPreview data={reportData} printerFormat={paperSize} />
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-gray-500">
              <p>No data available for this terminal since last Z-reading.</p>
              <Button onClick={loadReportData} variant="outline" size="sm" className="mt-4">Retry</Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
