'use client';

import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft } from 'lucide-react';
import type { Sale, SystemSettings } from '@/lib/types';
import { ReceiptView } from '../receipt/ReceiptView';
import { mapSaleToReceiptDetails } from './recent-sales-utils';

interface ReceiptPrintViewProps {
  sale: Sale;
  onBack: () => void;
  onPrint: () => void;
  settings?: SystemSettings | null;
  isReprint?: boolean;
}

export function ReceiptPrintView({
  sale,
  onBack,
  onPrint,
  settings,
  isReprint
}: ReceiptPrintViewProps) {
  const saleDetails = { ...mapSaleToReceiptDetails(sale), isReprint };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4 non-printable">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <Button onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print Receipt
        </Button>
      </div>

      <div className="printable-area bg-white p-4 shadow-sm mx-auto">
        <ReceiptView saleDetails={saleDetails} settings={settings} />
      </div>
    </div>
  );
}
