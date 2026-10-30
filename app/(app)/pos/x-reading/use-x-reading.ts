'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import type { XReadingData } from '../../sales/x-reading/x-reading-preview';
import type { BusinessSettings } from '../../sales/z-reading/z-reading-preview';

// A cashier is standing at the terminal waiting for this, so the bound is
// tighter than the back-office reports': this request asks for one shift
// (limit=1) and should never take long.
const REPORT_FETCH_TIMEOUT_MS = 20_000;

export function useXReading() {
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [xReadingData, setXReadingData] = useState<XReadingData | null>(null);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setIsAuthDialogOpen(true);
  }, []);

  const loadXReadingData = async () => {
    setLoading(true);
    try {
      const settingsResponse = await fetch(getApiUrl('/pos-settings'));
      if (!settingsResponse.ok) throw new Error(`API error ${settingsResponse.status}`);
      const settingsResult = await settingsResponse.json();
      if (settingsResult.success) setBusinessSettings(settingsResult.data);

      // Prefer the current POS session's own shift (mirrors the in-POS
      // X-Reading dialog at pos/x-reading-report/use-x-reading-report.tsx).
      // Falling back to "most recently started active shift, system-wide"
      // is wrong whenever more than one shift is active at once — it can
      // silently report on a different terminal's empty shift instead.
      const storedShiftId = localStorage.getItem('pos_current_shift_id');
      const url = storedShiftId
        ? `/sales/x-reading?shiftId=${storedShiftId}&limit=1`
        : '/sales/x-reading?shiftStatus=active&limit=1';
      // fetch() has no timeout, so a wedged route (a saturated connection
      // pool used to hang one forever) left the dialog on "Loading…" with no
      // toast and no way to tell it had failed. Bound the wait so the catch
      // below can actually report it.
      const response = await fetch(getApiUrl(url), { signal: AbortSignal.timeout(REPORT_FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();

      // A server-side failure is NOT "no active shift": reporting it that way
      // told the cashier their shift was missing when the request had in fact
      // errored. Separate the two so the real cause reaches the screen.
      if (!result.success) {
        throw new Error(result.details || result.error || 'The X-reading request failed');
      }

      if (result.data.length > 0) {
        setXReadingData(result.data[0]);
      } else {
        toast({ title: 'No Active Shift', description: 'There is no active cashier shift to report on.', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Error loading X-reading data:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load X-reading data.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAdminAuthSuccess = () => {
    setIsAuthDialogOpen(false);
    setShowReport(true);
    loadXReadingData();
  };

  const handlePrint = async () => {
    if (!xReadingData) return;
    try {
      const settingsResponse = await fetch(getApiUrl('/pos-settings'));
      if (!settingsResponse.ok) throw new Error(`API error ${settingsResponse.status}`);
      const settingsResult = await settingsResponse.json();
      const settings = settingsResult.success ? settingsResult.data : {};

      if (settings.printMode === 'escpos' || settings.printMode === 'usb') {
        const { XReadingGenerator } = await import('@/lib/x-reading-generator');
        const generator = new XReadingGenerator();
        const printData = { ...xReadingData, businessName: settings.businessName, operatedBy: settings.operatedBy, address: settings.address, tin: settings.tin, contactNumber: settings.contactNumber, email: settings.email };
        const uint8Array = generator.generate(printData);
        if ((window as any).electron) {
          await (window as any).electron.printThermal(uint8Array);
          toast({ title: 'X-Reading Printed', description: 'Thermal receipt has been sent to printer.' });
          return;
        }
      }
      window.print();
      toast({ title: 'X-Reading Printed', description: 'Cashier shift report has been printed.' });
    } catch (error) {
      console.error('Print error:', error);
      toast({ title: 'Print Error', description: 'Failed to print X-reading report.', variant: 'destructive' });
    }
  };

  return {
    isAuthDialogOpen, setIsAuthDialogOpen,
    showReport, setShowReport,
    xReadingData, businessSettings, loading,
    handleAdminAuthSuccess,
    loadXReadingData,
    handlePrint,
  };
}
