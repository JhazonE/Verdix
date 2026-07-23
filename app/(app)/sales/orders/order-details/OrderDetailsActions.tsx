'use client';

import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

type Props = {
  onPrint: () => void;
  onPrintPOSInvoice: () => void;
  onClose: () => void;
};

export function OrderDetailsActions({ onPrint, onPrintPOSInvoice, onClose }: Props) {
  return (
    // These are controls around the paper, not the paper itself, so they
    // follow the theme. The removed `bg-white` overrides forced a white face
    // under `variant="outline"`'s theme-aware text, leaving white-on-white
    // labels in dark mode.
    <div className="flex justify-center gap-3 p-4 border-t non-printable bg-muted/30 shrink-0">
      <Button variant="outline" onClick={onPrint} className="h-10 px-6 font-bold text-xs uppercase tracking-tight shadow-sm">
        <Printer className="mr-2 h-4 w-4" /> Print
      </Button>
      <Button variant="outline" onClick={onPrintPOSInvoice} className="h-10 px-6 font-bold text-xs uppercase tracking-tight shadow-sm">
        <Printer className="mr-2 h-4 w-4" /> Print POS Invoice
      </Button>
      <Button variant="outline" onClick={onPrint} className="h-10 px-6 font-bold text-xs uppercase tracking-tight shadow-sm">
        <Printer className="mr-2 h-4 w-4" /> Print to template
      </Button>
      <Button variant="outline" onClick={onClose} className="h-10 px-6 font-bold text-xs uppercase tracking-tight">
        Close
      </Button>
    </div>
  );
}
