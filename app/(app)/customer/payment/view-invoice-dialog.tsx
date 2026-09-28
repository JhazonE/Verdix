
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Eye, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { getApiUrl } from '@/lib/api-config';
import { formatCurrency } from '@/lib/utils';

interface ViewInvoiceDialogProps {
  invoiceId: string;
  children?: React.ReactNode;
}

interface InvoiceDetail {
  id: string;
  customer: {
    name: string;
    contactNumber: string;
    address?: string;
  };
  invoiceDate: string;
  dueDate: string;
  total: number;
  paymentMethod: string;
  status: string;
  notes?: string;
  items: {
    id: string;
    productName: string;
    barcode?: string;
    quantity: number;
    price: number;
    total: number;
    uom: string;
  }[];
}

export default function ViewInvoiceDialog({ invoiceId, children }: ViewInvoiceDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);

  useEffect(() => {
    if (isOpen && invoiceId) {
      fetchInvoiceDetails();
    }
  }, [isOpen, invoiceId]);

  const fetchInvoiceDetails = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(getApiUrl(`/customers/invoices/${encodeURIComponent(invoiceId)}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setInvoice(result.data);
      } else {
        console.error(result.error);
      }
    } catch (error) {
      console.error('Failed to fetch invoice details', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateSubtotal = () => {
    if (!invoice?.items) return 0;
    return invoice.items.reduce((acc, item) => acc + item.total, 0);
  };

  const handlePrint = () => {
    if (!invoice) return;

    const printWindow = window.open('', '', 'height=800,width=800');
    if (!printWindow) return;

    printWindow.document.write('<html><head><title>Invoice ' + invoice.id + '</title>');
    printWindow.document.write('<style>');
    printWindow.document.write(`
      body { font-family: sans-serif; padding: 40px; color: #020817; }
      .header-container { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; }
      .title-group { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
      .brand-group { display: flex; align-items: center; gap: 0.5rem; }
      .brand-text { font-size: 1.25rem; font-weight: 600; }
      
      .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; font-size: 0.875rem; color: #64748b; padding-top: 1rem; }
      .info-label { font-weight: 600; color: #020817; margin-bottom: 0.25rem; }
      
      table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; font-size: 0.875rem; }
      th { text-align: left; padding: 0.75rem; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500; }
      td { padding: 0.75rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
      .text-right { text-align: right; }
      
      .total-row td { border-top: 2px solid #020817; font-weight: bold; font-size: 1.125rem; padding-top: 1rem; }
      
      .footer { margin-top: 3rem; display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; font-size: 0.875rem; }
      .signature-line { border-bottom: 1px solid #020817; margin-bottom: 0.5rem; }
      .text-center { text-align: center; }
      .disclaimer { grid-column: 1 / -1; text-align: center; color: #64748b; font-size: 0.75rem; margin-top: 1rem; }
      
      @media print {
        body { padding: 0; }
        .no-print { display: none; }
      }
    `);
    printWindow.document.write('</style></head><body>');

    const displayDate = invoice.invoiceDate;
    const displayDueDate = invoice.dueDate;

    printWindow.document.write(`
      <div class="header-container">
        <div>
          <div class="title-group">
            <h1 style="font-size: 1.5rem; font-weight: 600; margin: 0;">Sales Invoice</h1>
          </div>
          <div style="font-size: 0.875rem; color: #64748b;">Invoice ID: ${invoice.id}</div>
        </div>
        <div class="brand-group">
           <!-- Placeholder for Logo if needed, using text for now -->
          <h1 class="brand-text" style="color: #2563eb;">verdix</h1>
        </div>
      </div>

      <div class="info-grid">
        <div>
          <div class="info-label">Customer:</div>
          <div>${invoice.customer.name}</div>
          <div>${invoice.customer.contactNumber}</div>
          ${invoice.customer.address ? `<div>${invoice.customer.address}</div>` : ''}
        </div>
        <div>
          <div class="info-label">Invoice Date:</div>
          <div>${displayDate ? format(new Date(displayDate), 'PPP') : 'N/A'}</div>
          <div style="margin-top: 0.5rem;" class="info-label">Due Date:</div>
          <div>${displayDueDate ? format(new Date(displayDueDate), 'PPP') : 'N/A'}</div>
        </div>
        <div>
          <div class="info-label">Payment Method:</div>
          <div>${invoice.paymentMethod}</div>
          <div style="margin-top: 0.5rem;" class="info-label">Status:</div>
          <div>${invoice.status}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Barcode</th>
            <th class="text-right">Quantity</th>
            <th class="text-right">Price per Item</th>
            <th class="text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.items.map(item => `
            <tr>
              <td>${item.productName}</td>
              <td>${item.barcode || '-'}</td>
              <td class="text-right">${item.quantity}</td>
              <td class="text-right">${formatCurrency(item.price)}</td>
              <td class="text-right">${formatCurrency(item.total)}</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td colspan="4" class="text-right">Total</td>
            <td class="text-right">${formatCurrency(invoice.total)}</td>
          </tr>
        </tbody>
      </table>

      <div class="footer">
        <div>
          <div class="signature-line"></div>
          <div class="text-center">Signature over Printed Name</div>
        </div>
        <div>
          <div class="signature-line"></div>
          <div class="text-center">Date Received</div>
        </div>
        <div class="disclaimer">
          Received the above goods in good order and condition.
        </div>
      </div>
    `);

    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="ghost" size="icon" title="View Details">
            <Eye className="h-4 w-4 text-blue-600" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <span>Invoice Details</span>
                {invoice && <Badge variant={invoice.status === 'Paid' ? 'default' : 'secondary'}>{invoice.status}</Badge>}
            </div>
            {invoice && (
                <Button variant="outline" size="sm" onClick={handlePrint}>
                    <Printer className="mr-2 h-4 w-4" /> Print
                </Button>
            )}
          </DialogTitle>
          <DialogDescription>
             Reference: <span className="font-mono font-medium text-foreground">{invoiceId}</span>
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : invoice ? (
          <div className="space-y-6">
            {/* Header Info */}
            <div className="grid grid-cols-2 gap-4 text-sm bg-muted/20 p-4 rounded-lg border">
              <div className="space-y-1">
                <h4 className="font-semibold text-muted-foreground uppercase text-xs">Customer</h4>
                <p className="font-medium text-base">{invoice.customer.name}</p>
                <div className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-xs">Contact:</span> {invoice.customer.contactNumber}
                </div>
                 {invoice.customer.address && <p className="text-muted-foreground text-xs">{invoice.customer.address}</p>}
              </div>
              <div className="space-y-1 text-right">
                <h4 className="font-semibold text-muted-foreground uppercase text-xs">Details</h4>
                <div className="flex justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">Issued:</span>
                    <span className="font-medium">{format(new Date(invoice.invoiceDate), 'PP')}</span>
                </div>
                <div className="flex justify-end gap-2 text-sm">
                    <span className="text-muted-foreground">Due:</span>
                    <span className="font-medium">{invoice.dueDate ? format(new Date(invoice.dueDate), 'PP') : 'N/A'}</span>
                </div>
                 <div className="flex justify-end gap-2 text-sm mt-2">
                    <span className="text-muted-foreground">Payment Method:</span>
                    <span className="font-medium">{invoice.paymentMethod}</span>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right">{item.quantity} <span className="text-xs text-muted-foreground">{item.uom}</span></TableCell>
                      <TableCell className="text-right">{formatCurrency(item.price)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Summary */}
            <div className="flex justify-end">
                <div className="w-1/2 sm:w-1/3 space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>{formatCurrency(calculateSubtotal())}</span>
                    </div>
                     <div className="flex justify-between text-lg font-bold border-t pt-2 mt-2">
                        <span>Total</span>
                        <span>{formatCurrency(invoice.total)}</span>
                    </div>
                </div>
            </div>
             
             {/* Notes */}
             {invoice.notes && (
                <div className="bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-md text-sm border border-yellow-100 dark:border-yellow-900/20">
                    <h4 className="font-semibold text-yellow-800 dark:text-yellow-500 mb-1">Notes</h4>
                    <p className="text-yellow-700 dark:text-yellow-400/90">{invoice.notes}</p>
                </div>
             )}

          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">Failed to load invoice details.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
