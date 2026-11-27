'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AdminAuthDialog } from '../admin-auth/AdminAuthDialog';
import { ZReadingPreview, BusinessSettings } from '../../sales/z-reading/z-reading-preview';
import type { ZReadingData } from '@/lib/types';
import { usePrinter } from '@/lib/use-printer';
import { ZReadingGenerator } from '@/lib/z-reading-generator';
import { getApiUrl } from '@/lib/api-config';
import { withTerminalPaperSize } from '@/lib/pos-paper-size';
import { useReactToPrint } from 'react-to-print';
import type { ZReadingDialogProps } from './z-reading-report-types';
import { ReadingConfirm, guardedSheetProps } from '../reading-confirm/ReadingConfirm';

// onBack asks before closing (the back arrow); onDone closes outright, used
// once a finalize has finished and there is nothing left to lose.
function ZReadingReportView({ onBack, onDone, printMode, terminalId, terminalName, initialData }: { onBack: () => void, onDone: () => void, printMode: 'browser' | 'escpos' | 'usb' | 'native', terminalId?: string, terminalName?: string, initialData?: ZReadingData | null }): JSX.Element {
  const [data, setData] = useState<ZReadingData | null>(initialData || null);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [isSaving, setIsSaving] = useState(false);
  const nativePrinterName = typeof window !== 'undefined' ? localStorage.getItem('pos_printer_name') || undefined : undefined;
  const { isPrinting, isConnected, connect, print } = usePrinter(printMode, nativePrinterName);
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);
  const paperSize = businessSettings?.paperSize || '58mm';

  const handleReactToPrint = useReactToPrint({
    contentRef: contentRef,
    content: () => contentRef.current,
    documentTitle: 'Z-Reading-Report',
    pageStyle: `
      @page { size: ${paperSize} auto; margin: 0; }
      @media print {
        body { visibility: visible !important; -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
        * { visibility: visible !important; }
        .printable-area { box-shadow: none !important; margin: 0 !important; width: ${paperSize} !important; min-width: ${paperSize} !important; max-width: ${paperSize} !important; }
      }
    `,
    onAfterPrint: () => console.log('Print finished'),
    onPrintError: (error: unknown) => console.error('Print error:', error),
  } as any);

  useEffect(() => {
    const fetchData = async () => {
      if (initialData) {
        try {
          const settingsRes = await fetch(getApiUrl('/pos-settings'));
          if (!settingsRes.ok) throw new Error(`API error ${settingsRes.status}`);
          const settingsResult = await settingsRes.json();
          if (settingsResult.success) setBusinessSettings(withTerminalPaperSize(settingsResult.data));
        } catch (e) { console.error(e); }
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const settingsRes = await fetch(getApiUrl('/pos-settings'));
        if (!settingsRes.ok) throw new Error(`API error ${settingsRes.status}`);
        const settingsResult = await settingsRes.json();
        if (settingsResult.success) setBusinessSettings(withTerminalPaperSize(settingsResult.data));
        const response = await fetch(getApiUrl(`/sales/z-reading?mode=current&terminalId=${terminalId || 'all'}`));
        if (!response.ok) throw new Error(`API error ${response.status}`);
        const result = await response.json();
        if (result.success && result.data.length > 0) {
          setData({ ...result.data[0], reportDate: new Date(result.data[0].reportDate), terminalName: terminalName });
        }
      } catch (error) {
        console.error('Error loading Z-Reading:', error);
        toast({ title: 'Error', description: 'Failed to load Z-Reading data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [toast, initialData, terminalId, terminalName]);

  // Printing is attempted separately from recording and can never abort it.
  // Returns false if the receipt did not come out, so the caller can say so
  // without implying the reading was lost.
  const attemptPrint = async (isReprint: boolean): Promise<boolean> => {
    try {
      if (printMode === 'browser') {
        if (!handleReactToPrint) throw new Error('Print engine not ready');
        handleReactToPrint();
        return true;
      }
      if (!isConnected) {
        const success = await connect();
        if (!success) throw new Error('Could not connect to printer');
      }
      const generator = new ZReadingGenerator();
      const bytes = generator.generate({ ...data, terminalName } as any, businessSettings, isReprint);
      await print(bytes);
      return true;
    } catch (error: any) {
      console.error('Z-Reading print error:', error);
      return false;
    }
  };

  const [isPrintConfirmOpen, setIsPrintConfirmOpen] = useState(false);

  // A new reading asks "Print?" first; either answer saves it. A historical
  // report is already recorded, so its button is a plain reprint.
  const handleFinalizeClick = () => {
    if (!data) return;
    if (data.id === 'PREVIEW') setIsPrintConfirmOpen(true);
    else handlePrintAndFinalize(true);
  };

  const handlePrintChoice = (shouldPrint: boolean) => {
    setIsPrintConfirmOpen(false);
    handlePrintAndFinalize(shouldPrint);
  };

  const handlePrintAndFinalize = async (shouldPrint: boolean) => {
    if (!data) return;

    // A historical report is already recorded — nothing to persist, just print.
    if (data.id !== 'PREVIEW') {
      const printed = await attemptPrint(true);
      toast(
        printed
          ? { title: 'Report Printed', description: 'Historical Z-Reading report printed.' }
          : { title: 'Print Failed', description: 'Could not print the report. The saved Z-Reading is unchanged — you can try printing again.', variant: 'destructive' },
      );
      return;
    }

    // RECORD FIRST, then print. A Z-reading is a required BIR record and the
    // daily totals reset against it, so a printer fault must never be able to
    // lose it: this used to print first inside the same try, and any printer
    // failure threw past the POST, finalizing nothing. A receipt can always be
    // reprinted from a saved reading; a reading never written is unrecoverable.
    // Tracked separately from isLoading on purpose: isLoading swaps the whole
    // component for a spinner, which unmounts the contentRef that
    // react-to-print prints from. Saving before printing must not tear down the
    // thing about to be printed.
    let savedId: string | undefined;
    try {
      setIsSaving(true);
      const saveResponse = await fetch(getApiUrl('/sales/z-reading'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, terminalId: terminalId || 'all', cashierName: data.cashierName || 'Admin' })
      });
      const saveResult = await saveResponse.json();
      if (!saveResult.success) throw new Error(saveResult.error || 'Failed to save Z-Reading to database');
      savedId = saveResult.data?.[0]?.id;
    } catch (error: any) {
      console.error('Z-Reading Error:', error);
      toast({ title: 'Error', description: error.message || 'Failed to finalize Z-Reading.', variant: 'destructive' });
      return;
    } finally {
      setIsSaving(false);
    }

    const label = savedId ? `Report ${savedId}` : 'The Z-Reading';

    // Operator answered "No" — the reading is recorded, just not printed.
    if (!shouldPrint) {
      toast({ title: 'Z-Reading Saved', description: `${label} has been saved without printing. You can print it later from Sales › Z-Reading.` });
      setTimeout(() => onDone(), 1500);
      return;
    }

    const printed = await attemptPrint(false);

    // Distinguish "recorded but not printed" from "not recorded" — they need
    // different actions from the operator (reprint vs. re-run the Z-reading).
    toast(
      printed
        ? { title: 'Z-Reading Finalized', description: `${label} has been saved successfully.` }
        : { title: 'Z-Reading Saved — Print Failed', description: `${label} was recorded successfully, but the receipt did not print. Reprint it from Sales › Z-Reading.`, variant: 'destructive' },
    );
    setTimeout(() => onDone(), 1500);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full max-h-[85vh]">
        <SheetHeader className="px-4 py-3 border-b flex-none text-left space-y-0">
          <SheetTitle>Z-READING REPORT</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col items-center justify-center flex-1">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Generating Z-Reading Report...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col h-full max-h-[85vh]">
        <SheetHeader className="px-4 py-3 border-b flex-none text-left space-y-0">
          <SheetTitle>Z-READING REPORT</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col items-center justify-center flex-1">
          <p className="text-muted-foreground">No Z-Reading data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[85vh]">
      <SheetHeader className="px-4 py-3 border-b flex-none flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <SheetTitle>Z-READING REPORT</SheetTitle>
        </div>
        <Button size="sm" onClick={handleFinalizeClick} disabled={isLoading || isPrinting || isSaving || isPrintConfirmOpen}>
          {isPrinting || isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
          {isSaving ? 'Recording…' : data.id === 'PREVIEW' ? 'Finalize' : 'Print'}
        </Button>
      </SheetHeader>
      <ReadingConfirm
        open={isPrintConfirmOpen}
        title="Print Z-Reading?"
        description={
          <>
            The reading will be <span className="font-medium text-foreground">saved either way</span>. Choose
            No to save it without printing — you can still print it later from Sales › Z-Reading.
          </>
        }
        yesLabel="Yes, Print & Save"
        noLabel="No, Save Only"
        onYes={() => handlePrintChoice(true)}
        onNo={() => handlePrintChoice(false)}
        onCancel={() => setIsPrintConfirmOpen(false)}
      />
      <div className="flex-1 overflow-auto bg-muted/20 p-4 flex justify-center">
        <div ref={contentRef} className="bg-white shadow-lg h-fit w-fit">
          <ZReadingPreview data={data} businessSettings={businessSettings} printerFormat={paperSize} />
        </div>
      </div>
    </div>
  );
}

export function ZReadingDialog({ isOpen, onOpenChange, terminalId, terminalName, printMode, initialData, autoShow, requireAuth = true, authCredentials }: ZReadingDialogProps) {
  // initialData/autoShow are the end-shift report paths; !requireAuth is the
  // POS Setup toggle being off. All three go straight to the report.
  const skipAuth = !!initialData || !!autoShow || !requireAuth;
  const [showReport, setShowReport] = useState(skipAuth);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowReport(skipAuth);
    } else {
      setShowReport(false);
    }
    setIsCloseConfirmOpen(false);
  }, [isOpen, skipAuth]);

  const authSucceededRef = useRef(false);

  const handleAuthSuccess = () => {
    authSucceededRef.current = true;
    setShowReport(true);
  };

  return (
    <>
      {/* Rendered as a sibling, not nested inside SheetContent: Radix Dialog
          and Sheet share the same portal primitive, and a Dialog portaled
          inside a Sheet's portal content causes the Sheet's outside-click
          detection to treat the nested Dialog as "outside" and dismiss
          itself, closing the report the instant auth succeeds. */}
      <AdminAuthDialog
        isOpen={isOpen && !showReport}
        requiredCredentials={authCredentials}
        onOpenChange={(open) => {
          // useAdminAuth calls onSuccess() then onOpenChange(false) as part
          // of the same authenticate flow - only treat this as the user
          // closing/cancelling when auth did NOT just succeed, otherwise the
          // outer isOpen flips false and wipes out the showReport we just set.
          if (!open && !authSucceededRef.current) onOpenChange(false);
          authSucceededRef.current = false;
        }}
        title="Z-Reading Authorization"
        description="Admin password is required to generate the report."
        onSuccess={handleAuthSuccess}
      />

      {/* Outside clicks never close the drawer; the back arrow and Escape
          ask first (guardedSheetProps + the Close prompt below). */}
      <Sheet open={isOpen && showReport} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl h-full overflow-hidden flex flex-col p-0 gap-0 [&>button]:hidden"
          {...guardedSheetProps(() => setIsCloseConfirmOpen(true))}
        >
          <ZReadingReportView
            onBack={() => setIsCloseConfirmOpen(true)}
            onDone={() => onOpenChange(false)}
            printMode={printMode}
            terminalId={terminalId}
            terminalName={terminalName}
            initialData={initialData}
          />
          <ReadingConfirm
            open={isCloseConfirmOpen}
            icon="close"
            title="Close Z-Reading?"
            description="Are you sure you want to close the Z-Reading report?"
            yesLabel="Yes, Close"
            noLabel="No"
            onYes={() => { setIsCloseConfirmOpen(false); onOpenChange(false); }}
            onNo={() => setIsCloseConfirmOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
