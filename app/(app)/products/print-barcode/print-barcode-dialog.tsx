'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, Printer } from 'lucide-react';
import type { Product } from '@/lib/types';

import { BARCODE_FORMATS, LABEL_SIZES, PAPER_TYPES } from './barcode-utils';
import { PreviewLabel } from './preview-label';
import { usePrintBarcode } from './use-print-barcode';

interface PrintBarcodeDialogProps {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintBarcodeDialog({ product, open, onOpenChange }: PrintBarcodeDialogProps) {
  const {
    units,
    qtyByUnit,
    setUnitQty,
    unitDataUrls,
    totalLabels,
    previewProduct,
    sizeIndex,
    setSizeIndex,
    format,
    setFormat,
    showPrice,
    setShowPrice,
    showName,
    setShowName,
    paperType,
    setPaperType,
    size,
    barcodeValue,
    dataUrl,
    handlePrint,
    handleExportPDF,
  } = usePrintBarcode({ product });

  if (!barcodeValue) return null;

  const hasMultipleUnits = units.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Print Barcode — {product.name}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Paper Type</Label>
            <Select value={paperType} onValueChange={(v) => setPaperType(v as typeof paperType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAPER_TYPES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Label Size</Label>
            <Select value={sizeIndex.toString()} onValueChange={(v) => setSizeIndex(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LABEL_SIZES.map((s, i) => (
                  <SelectItem key={i} value={i.toString()}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Barcode Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BARCODE_FORMATS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!hasMultipleUnits && (
            <div className="grid gap-1.5">
              <Label htmlFor="print-qty">Quantity</Label>
              <Input
                id="print-qty"
                type="number"
                min={1}
                max={500}
                value={qtyByUnit[units[0].key] ?? 0}
                onChange={(e) => setUnitQty(units[0].key, Math.max(1, Number(e.target.value)))}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>Show on Label</Label>
            <div className="flex flex-col gap-1.5 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
                Product Name
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
                Price
              </label>
            </div>
          </div>
        </div>

        {hasMultipleUnits && (
          <div className="grid gap-1.5">
            <Label>Selling Units — labels to print</Label>
            <div className="border rounded-lg divide-y">
              {units.map((u) => (
                <div key={u.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {u.name}{u.isBase ? ' (base)' : ''}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {u.value}
                      {!unitDataUrls[u.key] && ' — invalid for this format'}
                    </div>
                  </div>
                  <Input
                    aria-label={`Labels for ${u.name}`}
                    type="number"
                    min={0}
                    max={500}
                    className="w-20"
                    value={qtyByUnit[u.key] ?? 0}
                    onChange={(e) => setUnitQty(u.key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border rounded-lg p-4 bg-muted/30">
          <p className="text-xs text-muted-foreground mb-3 font-medium">Preview</p>
          <div className="flex justify-center">
            <PreviewLabel
              product={previewProduct}
              size={size}
              dataUrl={dataUrl}
              showName={showName}
              showPrice={showPrice}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleExportPDF} disabled={totalLabels < 1} className="gap-2">
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
          <Button onClick={handlePrint} disabled={totalLabels < 1} className="gap-2">
            <Printer className="h-4 w-4" />
            Print {totalLabels} Label{totalLabels !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
