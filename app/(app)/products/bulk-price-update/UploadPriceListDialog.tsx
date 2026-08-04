'use client';

import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUploadPriceList } from './use-upload-price-list';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  onUpdated?: () => void;
}

function getCurrentUserId(): string {
  try {
    const raw = localStorage.getItem('mock-user-session');
    return raw ? JSON.parse(raw).uid : 'system';
  } catch {
    return 'system';
  }
}

export function UploadPriceListDialog({ open, onOpenChange, warehouseId, onUpdated }: Props) {
  const up = useUploadPriceList(warehouseId, onUpdated);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasCreateRows = (up.preview?.toCreate.length ?? 0) > 0;
  const canSubmit = !!up.preview
    && (up.preview.matched.length > 0 || up.preview.toCreate.length > 0)
    && (!hasCreateRows || up.confirmCreate)
    && !up.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) up.reset(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Price List</DialogTitle>
          <DialogDescription>Upload a filled-in price list spreadsheet for this warehouse.</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="block w-full text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) up.handleFile(file);
          }}
        />

        {up.isParsing && <p className="text-sm text-muted-foreground">Reading file...</p>}

        {up.preview && (
          <div className="space-y-4">
            {up.preview.matched.length > 0 && (
              <div className="border rounded-lg max-h-56 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead className="text-right">Old</TableHead>
                      <TableHead className="text-right">New</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {up.preview.matched.map((item, i) => (
                      <TableRow key={`${item.productId}-${item.field}-${i}`}>
                        <TableCell>{item.productName}</TableCell>
                        <TableCell>{item.field}</TableCell>
                        <TableCell className="text-right">₱{item.oldValue.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium">₱{item.newValue.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {hasCreateRows && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{up.preview.toCreate.length} new product(s) will be created</p>
                <div className="border rounded-lg max-h-56 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {up.preview.toCreate.map((row, i) => (
                        <TableRow key={`${row.sku}-${i}`}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>{row.sku}</TableCell>
                          <TableCell>{row.brand}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell className="text-right">₱{row.price.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="confirmCreate" checked={up.confirmCreate} onCheckedChange={(c) => up.setConfirmCreate(!!c)} />
                  <Label htmlFor="confirmCreate" className="text-sm font-normal">
                    I understand {up.preview.toCreate.length} new product(s) will be created
                  </Label>
                </div>
              </div>
            )}

            {up.preview.skipped.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{up.preview.skipped.length} row(s) skipped</summary>
                <ul className="mt-2 space-y-1 list-disc pl-5">
                  {up.preview.skipped.map((s, i) => (
                    <li key={i}>{s.row.sku || s.row.barcode || `Row ${i + 1}`}: {s.reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={!canSubmit}
            onClick={() => up.submit(getCurrentUserId())}
          >
            {up.isSubmitting ? 'Submitting...' : `Submit ${(up.preview?.matched.length ?? 0) + (up.preview?.toCreate.length ?? 0)} Change(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
