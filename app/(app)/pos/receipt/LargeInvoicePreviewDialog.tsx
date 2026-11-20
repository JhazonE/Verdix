'use client';

import { useCallback, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { LargeInvoiceView } from './LargeInvoiceView';
import type { ReceiptViewProps } from './receipt-types';

interface LargeInvoicePreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    saleDetails: ReceiptViewProps['saleDetails'] | null;
    settings: ReceiptViewProps['settings'];
    /** Runs after the print job is handed to the browser (e.g. finish checkout). */
    onPrinted?: () => void | Promise<void>;
}

// Shared by checkout (TenderDialog) and the Recent Sales reprint so the two
// can never drift apart in layout or page setup.
export function LargeInvoicePreviewDialog({
    open,
    onOpenChange,
    saleDetails,
    settings,
    onPrinted,
}: LargeInvoicePreviewDialogProps) {
    const [scale, setScale] = useState(1);
    const [sheetHeight, setSheetHeight] = useState<number | null>(null);
    const fitObserverRef = useRef<ResizeObserver | null>(null);
    const sheetObserverRef = useRef<ResizeObserver | null>(null);
    const invoiceRef = useRef<HTMLDivElement>(null);

    const printInvoice = useReactToPrint({
        contentRef: invoiceRef,
        documentTitle: `Invoice-${new Date().getTime()}`,
        pageStyle: `
            /* 9.5in x 5.5in continuous pinfeed stock (dot-matrix). The 9.5in
               includes the tractor-feed strips, so the printable width is 8in. */
            @page { size: 9.5in 5.5in; margin: 0 0.75in; }
            @media print {
                body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
                /* globals.css forces .printable-area to width:100% for the
                   back-office reports; that would stretch this sheet across the
                   full 9.5in and into the tractor strips, so it is pinned back
                   to the 8in the invoice is actually laid out for. */
                .printable-area {
                    box-shadow: none !important;
                    margin: 0 !important;
                    width: 8in !important;
                    /* The preview wrapper scales the sheet to fit the dialog;
                       that must never follow it onto the paper. */
                    transform: none !important;
                    zoom: 1 !important;
                }
            }
        `
    });

    // The invoice is a fixed 8in wide, so it has to be fitted to whatever width the
    // dialog ends up with: shrink it on a narrow screen rather than scroll sideways,
    // and enlarge it on a wide one so the sheet is actually readable.
    //
    // This is a callback ref, not a useEffect: the dialog mounts its content only
    // after it opens, so an effect keyed on the open flag runs while the node is
    // still null and never gets a second chance to measure.
    const fitRef = useCallback((el: HTMLDivElement | null) => {
        fitObserverRef.current?.disconnect();
        if (!el) return;

        const INVOICE_WIDTH_PX = 8 * 96; // 8in at the CSS 96dpi reference
        const MAX_SCALE = 2; // past this the text is larger than it prints

        const fit = () => {
            // clientWidth includes the horizontal padding the invoice cannot use.
            // Only width is fitted: constraining on height as well shrank the sheet
            // to fill a dialog that is deliberately not full height.
            const style = getComputedStyle(el);
            const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const available = el.clientWidth - padX;
            if (available <= 0) return;
            setScale(Math.min(MAX_SCALE, available / INVOICE_WIDTH_PX));
        };

        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(el);
        fitObserverRef.current = observer;
    }, []);

    // Tracks the sheet's own unscaled height, which grows with the line-item count.
    const sheetRef = useCallback((el: HTMLDivElement | null) => {
        sheetObserverRef.current?.disconnect();
        if (!el) {
            setSheetHeight(null);
            return;
        }

        const measure = () => setSheetHeight(el.offsetHeight);

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        sheetObserverRef.current = observer;
    }, []);

    const handlePrint = async () => {
        printInvoice();
        await onPrinted?.();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* sm:max-w-[...] is required, not max-w-[...]: the base DialogContent
                sets sm:max-w-lg, which outranks an unprefixed class and would pin
                this preview to 512px. */}
            <DialogContent className="w-[96vw] sm:max-w-[1600px] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 py-4 border-b text-left space-y-0.5">
                    <DialogTitle className="text-lg font-bold flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        Large Invoice Preview
                    </DialogTitle>
                    <DialogDescription>Review the layout before printing.</DialogDescription>
                </DialogHeader>
                {/* Scaling is visual only — react-to-print reads the original node
                    through its ref, so the printed sheet is unaffected. The outer div
                    is width-capped to the scaled size so the shrunk sheet still
                    centres and leaves no dead gutter beside it. */}
                <div ref={fitRef} className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/40 px-6 py-6">
                    <div
                        className="mx-auto"
                        style={{
                            width: `calc(8in * ${scale})`,
                            // scale() does not shrink the space the element reserves,
                            // so the wrapper height is clamped to the scaled height to
                            // avoid a tall dead area under the sheet.
                            height: sheetHeight ? sheetHeight * scale : undefined,
                        }}
                    >
                        <div
                            ref={sheetRef}
                            className="bg-white shadow-md w-[8in] origin-top-left"
                            style={{ transform: `scale(${scale})` }}
                        >
                            {saleDetails && <LargeInvoiceView ref={invoiceRef} saleDetails={saleDetails} settings={settings} />}
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t bg-background flex justify-end gap-3">
                    <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button size="lg" onClick={handlePrint} disabled={!saleDetails}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
