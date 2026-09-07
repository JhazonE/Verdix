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

  const hasCreateRows = (up.preview?.toCreate ?? 0) > 0;
  const canSubmit = !!up.preview
    && ((up.preview.matched ?? 0) > 0 || (up.preview.toCreate ?? 0) > 0)
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

        {up.progress && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {up.progress.phase === 'applying' ? 'Applying changes' : 'Matching products'}
              {up.progress.total > 0 && ` — ${up.progress.done.toLocaleString()} / ${up.progress.total.toLocaleString()}`}
            </p>
            <div className="h-2 w-full rounded bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: up.progress.total > 0 ? `${Math.round((up.progress.done / up.progress.total) * 100)}%` : '0%' }}
              />
            </div>
          </div>
        )}

        {up.preview && (
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <p>{up.preview.matched.toLocaleString()} product(s) will be updated</p>
              {hasCreateRows && <p>{up.preview.toCreate.toLocaleString()} new product(s) will be created</p>}
              {up.preview.skipped > 0 && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  {up.preview.skipped.toLocaleString()} row(s) skipped
                  <Button type="button" variant="link" className="h-auto p-0" onClick={up.downloadSkippedCsv}>
                    Download skipped rows (CSV)
                  </Button>
                </p>
              )}
            </div>

            {up.preview.matchedSample.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Showing first {up.preview.matchedSample.length} of {up.preview.matched.toLocaleString()}
                </p>
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
                      {up.preview.matchedSample.map((item: any, i: number) => (
                        <TableRow key={`${item.productId}-${item.field}-${i}`}>
                          <TableCell>{item.productName}</TableCell>
                          <TableCell>{item.field}</TableCell>
                          <TableCell className="text-right">₱{Number(item.oldValue).toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">₱{Number(item.newValue).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {hasCreateRows && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Showing first {up.preview.toCreateSample.length} of {up.preview.toCreate.toLocaleString()} new product(s)
                </p>
                <div className="border rounded-lg max-h-56 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {up.preview.toCreateSample.map((row: any, i: number) => (
                        <TableRow key={`${row.sku}-${i}`}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>{row.sku}</TableCell>
                          <TableCell>{row.brand}</TableCell>
                          <TableCell className="text-right">₱{Number(row.price).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="confirmCreate" checked={up.confirmCreate} onCheckedChange={(c) => up.setConfirmCreate(!!c)} />
                  <Label htmlFor="confirmCreate" className="text-sm font-normal">
                    I understand {up.preview.toCreate.toLocaleString()} new product(s) will be created
                  </Label>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={!canSubmit}
            onClick={() => up.submit(getCurrentUserId())}
          >
            {up.isSubmitting ? 'Submitting...' : `Submit ${((up.preview?.matched ?? 0) + (up.preview?.toCreate ?? 0)).toLocaleString()} Change(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
