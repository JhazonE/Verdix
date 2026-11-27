'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { XReadingPreview, XReadingData } from '../../sales/x-reading/x-reading-preview';
import type { BusinessSettings } from '../../sales/z-reading/z-reading-preview';
import { ReadingConfirm } from '../reading-confirm/ReadingConfirm';

interface XReadingReportViewProps {
  data: XReadingData;
  businessSettings: BusinessSettings | null;
  onPrint: () => Promise<void>;
}

export function XReadingReportView({ data, businessSettings, onPrint }: XReadingReportViewProps) {
  const is80mm = businessSettings?.paperSize === '80mm';
  const [isPrintConfirmOpen, setIsPrintConfirmOpen] = useState(false);
  const { toast } = useToast();
  // The X-Reading row is written by End Shift, not by this page.
  const shiftEnded = data.shiftStatus !== 'active';

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 flex flex-col items-center">
      <div style={{ width: is80mm ? '300px' : '220px' }} className="bg-white shadow-lg p-2 rounded-lg">
        <XReadingPreview data={data} printerFormat={is80mm ? '80mm' : '58mm'} businessSettings={businessSettings} />
      </div>
      <div className="flex justify-center space-x-4 print:hidden">
        <Button size="lg" onClick={() => setIsPrintConfirmOpen(true)} disabled={isPrintConfirmOpen}>
          <Printer className="mr-2 h-5 w-5" /> Print X-Reading
        </Button>
      </div>
      <ReadingConfirm
        open={isPrintConfirmOpen}
        title="Print X-Reading?"
        yesLabel="Yes, Print"
        noLabel="No, Don't Print"
        description={
          shiftEnded ? (
            <>
              This X-Reading was <span className="font-medium text-foreground">already saved</span> when the
              shift ended. Choose No to skip printing — you can still print it later from Sales › X-Reading.
            </>
          ) : (
            <>
              The X-Reading is <span className="font-medium text-foreground">saved automatically when the shift
              ends</span>. Choose No to skip printing.
            </>
          )
        }
        onYes={() => { setIsPrintConfirmOpen(false); onPrint(); }}
        onNo={() => {
          setIsPrintConfirmOpen(false);
          toast({ title: 'Not Printed', description: shiftEnded ? 'The X-Reading stays saved; no receipt was printed.' : 'No receipt was printed.' });
        }}
        onCancel={() => setIsPrintConfirmOpen(false)}
      />
    </div>
  );
}
