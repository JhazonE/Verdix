'use client';

import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { XReadingPreview, XReadingData } from '../../sales/x-reading/x-reading-preview';
import type { BusinessSettings } from '../../sales/z-reading/z-reading-preview';

interface XReadingReportViewProps {
  data: XReadingData;
  businessSettings: BusinessSettings | null;
  onPrint: () => Promise<void>;
}

export function XReadingReportView({ data, businessSettings, onPrint }: XReadingReportViewProps) {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 flex flex-col items-center">
      <div style={{ width: '220px' }} className="bg-white shadow-lg p-2 rounded-lg">
        <XReadingPreview data={data} printerFormat="58mm" businessSettings={businessSettings} />
      </div>
      <div className="flex justify-center space-x-4 print:hidden">
        <Button size="lg" onClick={onPrint}>
          <Printer className="mr-2 h-5 w-5" /> Print X-Reading
        </Button>
      </div>
    </div>
  );
}
