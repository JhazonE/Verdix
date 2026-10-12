'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePrinter } from '@/lib/use-printer';
import { getApiUrl } from '@/lib/api-config';
import { ZReadingPreview, ZReadingData } from '../../sales/z-reading/z-reading-preview';
import type { BusinessSettings } from './z-reading-types';

interface ZReadingReportViewProps {
  onPrint?: () => void;
}

export function ZReadingReportView({ onPrint }: ZReadingReportViewProps) {
  const { toast } = useToast();
  const nativePrinterName = typeof window !== 'undefined' ? localStorage.getItem('pos_printer_name') || undefined : undefined;
  const { print, isConnected, connect } = usePrinter('native', nativePrinterName);
  const [data, setData] = useState<ZReadingData | null>(null);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const settingsRes = await fetch(getApiUrl('/pos-settings'));
        if (!settingsRes.ok) throw new Error(`API error ${settingsRes.status}`);
        const settingsResult = await settingsRes.json();
        if (settingsResult.success) setBusinessSettings(settingsResult.data);

        const zRes = await fetch(getApiUrl('/sales/z-reading?mode=current'));
        if (!zRes.ok) throw new Error(`API error ${zRes.status}`);
        const zResult = await zRes.json();
        if (zResult.success && zResult.data?.length > 0) {
          setData(zResult.data[0]);
        } else {
          toast({ title: 'No Data', description: 'No Z-Reading data found for the current period.', variant: 'destructive' });
        }
      } catch (e) {
        console.error('[Z-Reading] Failed to fetch data:', e);
        toast({ title: 'Error', description: 'Failed to load Z-Reading data.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  const handlePrint = async () => {
    if (!data) return;

    // RECORD FIRST. This button announces "Z-Reading Finalized / daily totals
    // have been reset", so it must actually write the reading — it previously
    // only printed, and on this route no onPrint was wired either, which meant
    // it reported a finalize that never happened. A Z-reading is a required BIR
    // record, so recording cannot depend on the printer succeeding.
    const isPreview = !data.id || data.id === 'PREVIEW';
    let savedId: string | undefined;

    if (isPreview) {
      try {
        setIsSaving(true);
        const saveRes = await fetch(getApiUrl('/sales/z-reading'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, cashierName: data.cashierName || 'Admin' }),
        });
        const saveResult = await saveRes.json();
        if (!saveResult.success) throw new Error(saveResult.error || 'Failed to save Z-Reading');
        savedId = saveResult.data?.[0]?.id;
      } catch (e: any) {
        console.error('[Z-Reading] Failed to save:', e);
        toast({ title: 'Error', description: e?.message || 'Failed to finalize Z-Reading. Nothing was recorded — please try again.', variant: 'destructive' });
        setIsSaving(false);
        return;
      } finally {
        setIsSaving(false);
      }
    }

    // Only now attempt the receipt. A print failure is reported as such and
    // never undoes or hides the saved reading.
    let printSuccess = false;
    let printerConnected = isConnected;
    if (!printerConnected) printerConnected = await connect();
    if (printerConnected) {
      try {
        const { ReceiptGenerator } = await import('@/lib/receipt-generator');
        const generator = new ReceiptGenerator();
        const bytes = generator.generateZReadingReceipt(data, businessSettings);
        printSuccess = await print(bytes);
      } catch (e) {
        console.error('[Z-Reading] Native print error:', e);
      }
    }
    if (!printSuccess) {
      try {
        window.print();
        printSuccess = true;
      } catch (e) {
        console.error('[Z-Reading] Browser print error:', e);
      }
    }

    if (onPrint) onPrint();

    toast(
      printSuccess
        ? { title: 'Z-Reading Finalized', description: `The reading was recorded${savedId ? ` as ${savedId}` : ''} and the daily totals have been reset.` }
        : { title: 'Z-Reading Saved — Print Failed', description: `The reading was recorded${savedId ? ` as ${savedId}` : ''} and the daily totals have been reset, but the receipt did not print. Reprint it from Sales › Z-Reading.`, variant: 'destructive' },
    );
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="text-muted-foreground">Loading Z-Reading data...</div></div>;
  }

  if (!data) {
    return <div className="flex items-center justify-center h-64"><div className="text-muted-foreground">No Z-Reading data available.</div></div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 flex flex-col items-center">
      <div style={{ width: '220px' }} className="bg-white shadow-lg p-2 rounded-lg">
        <ZReadingPreview data={data} printerFormat="58mm" businessSettings={businessSettings} />
      </div>
      <div className="flex justify-center space-x-4 print:hidden">
        <Button size="lg" onClick={handlePrint} disabled={isSaving}>
          <Printer className="mr-2 h-5 w-5" />
          {isSaving ? 'Finalizing…' : 'Print Z-Reading & Finalize Shift'}
        </Button>
      </div>
    </div>
  );
}
