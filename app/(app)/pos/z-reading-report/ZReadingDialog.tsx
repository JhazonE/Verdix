'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
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
import { useReactToPrint } from 'react-to-print';
import type { ZReadingDialogProps } from './z-reading-report-types';

function ZReadingReportView({ onBack, printMode, terminalId, terminalName, initialData }: { onBack: () => void, printMode: 'browser' | 'escpos' | 'usb' | 'native', terminalId?: string, terminalName?: string, initialData?: ZReadingData | null }): JSX.Element {
  const [data, setData] = useState<ZReadingData | null>(initialData || null);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const { isPrinting, isConnected, connect, print } = usePrinter(printMode);
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
          if (settingsResult.success) setBusinessSettings(settingsResult.data);
        } catch (e) { console.error(e); }
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const settingsRes = await fetch(getApiUrl('/pos-settings'));
        if (!settingsRes.ok) throw new Error(`API error ${settingsRes.status}`);
        const settingsResult = await settingsRes.json();
        if (settingsResult.success) setBusinessSettings(settingsResult.data);
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

  const handlePrintAndFinalize = async () => {
    if (!data) return;
    try {
      if (printMode === 'browser') {
        if (handleReactToPrint) {
          handleReactToPrint();
        } else {
          throw new Error('Print engine not ready');
        }
      } else {
        if (!isConnected) {
          const success = await connect();
          if (!success) throw new Error('Could not connect to printer');
        }
        const generator = new ZReadingGenerator();
        const isReprint = data.id !== 'PREVIEW';
        const bytes = generator.generate({ ...data, terminalName } as any, businessSettings, isReprint);
        await print(bytes);
      }
      if (data.id === 'PREVIEW') {
        setIsLoading(true);
        const saveResponse = await fetch(getApiUrl('/sales/z-reading'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, terminalId: terminalId || 'all', cashierName: data.cashierName || 'Admin' })
        });
        const saveResult = await saveResponse.json();
        if (!saveResult.success) throw new Error(saveResult.error || 'Failed to save Z-Reading to database');
        toast({ title: 'Z-Reading Finalized', description: `Report ${saveResult.data[0].id} has been saved successfully.` });
        setTimeout(() => onBack(), 1500);
      } else {
        toast({ title: 'Report Printed', description: 'Historical Z-Reading report printed.' });
      }
    } catch (error: any) {
      console.error('Z-Reading Error:', error);
      toast({ title: 'Error', description: error.message || 'Failed to finalize Z-Reading.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
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
        <Button size="sm" onClick={handlePrintAndFinalize} disabled={isLoading || isPrinting}>
          {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
          {data.id === 'PREVIEW' ? 'Finalize & Print' : 'Print'}
        </Button>
      </SheetHeader>
      <div className="flex-1 overflow-auto bg-muted/20 p-4 flex justify-center">
        <div ref={contentRef} className="bg-white shadow-lg h-fit w-fit">
          <ZReadingPreview data={data} businessSettings={businessSettings} printerFormat={paperSize} />
        </div>
      </div>
    </div>
  );
}

export function ZReadingDialog({ isOpen, onOpenChange, terminalId, terminalName, printMode, initialData, autoShow }: ZReadingDialogProps) {
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [showReport, setShowReport] = useState(!!initialData || !!autoShow);

  useEffect(() => {
    if (isOpen) {
      if (initialData || autoShow) {
        setShowReport(true);
      } else {
        setIsAuthDialogOpen(true);
        setShowReport(false);
      }
    } else {
      setIsAuthDialogOpen(false);
      setShowReport(false);
    }
  }, [isOpen, initialData, autoShow]);

  const handleAuthSuccess = () => {
    setIsAuthDialogOpen(false);
    setShowReport(true);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl h-full overflow-hidden flex flex-col p-0 gap-0 [&>button]:hidden">
        {showReport ? (
          <ZReadingReportView
            onBack={() => onOpenChange(false)}
            printMode={printMode}
            terminalId={terminalId}
            terminalName={terminalName}
            initialData={initialData}
          />
        ) : (
          <div className="p-6">
            <SheetHeader className="text-left space-y-0.5">
              <SheetTitle>Z-Reading Authorization</SheetTitle>
              <SheetDescription>Admin password is required to generate the report.</SheetDescription>
            </SheetHeader>
            <AdminAuthDialog
              isOpen={isAuthDialogOpen}
              onOpenChange={setIsAuthDialogOpen}
              onSuccess={handleAuthSuccess}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
