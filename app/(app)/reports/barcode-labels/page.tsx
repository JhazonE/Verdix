'use client';

import { useEffect, useMemo, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, Loader2, Printer, Tags } from 'lucide-react';

import { getApiUrl } from '@/lib/api-config';
import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/lib/types';

import {
  BARCODE_FORMATS,
  LABEL_SIZES,
  PAPER_TYPES,
  buildPrintHTML,
  buildPrintPDF,
  generateBarcodeDataUrl,
  getLabelUnits,
  type LabelItem,
  type PaperType,
} from '@/app/(app)/products/print-barcode/barcode-utils';

export default function BarcodeLabelsReportPage() {
  const { toast } = useToast();

  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [qty, setQty] = useState(1);
  const [sizeIndex, setSizeIndex] = useState(0);
  const [format, setFormat] = useState('EAN8');
  const [paperType, setPaperType] = useState<PaperType>('A4');
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [includeUnits, setIncludeUnits] = useState(true);
  const [isBuilding, setIsBuilding] = useState<'print' | 'pdf' | null>(null);

  const size = LABEL_SIZES[sizeIndex];

  useEffect(() => {
    (async () => {
      setLoadingCategories(true);
      try {
        const res = await fetch(getApiUrl('/products/attributes'));
        const data = await res.json();
        if (data.success) setCategories(data.categories || []);
      } catch {
        toast({ title: 'Error', description: 'Failed to load categories.', variant: 'destructive' });
      } finally {
        setLoadingCategories(false);
      }
    })();
  }, [toast]);

  const loadProducts = async () => {
    if (!category) return;
    setLoadingProducts(true);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ category, limit: '10000', offset: '0' });
      const res = await fetch(getApiUrl(`/products?${params.toString()}`));
      const data = await res.json();
      if (data.success) {
        // GET /api/products passes MySQL DECIMAL columns through as strings;
        // coerce here so `typeof price === 'number'` checks downstream hold.
        const normalized: Product[] = (data.data || []).map((p: Product) => {
          const price = typeof p.price === 'number' ? p.price : Number(p.price);
          return { ...p, price: Number.isFinite(price) ? price : undefined };
        });
        setProducts(normalized);
      } else {
        toast({ title: 'Error', description: 'Failed to load products for this category.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load products for this category.', variant: 'destructive' });
    } finally {
      setLoadingProducts(false);
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = products.length > 0 && selected.size === products.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)));
  };

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected],
  );

  const buildLabelItems = (): { items: LabelItem[]; skipped: number } => {
    const items: LabelItem[] = [];
    let skipped = 0;
    for (const product of selectedProducts) {
      const units = getLabelUnits(product);
      // Base unit is always a candidate; other units only when opted in.
      let printed = false;
      for (const unit of includeUnits ? units : units.slice(0, 1)) {
        const dataUrl = unit.value ? generateBarcodeDataUrl(unit.value, format) : null;
        if (!dataUrl) continue;
        printed = true;
        items.push({ product, qty, dataUrl, unitName: unit.isBase ? undefined : unit.name, price: unit.price });
      }
      if (!printed) skipped++;
    }
    return { items, skipped };
  };

  const handlePrint = () => {
    const { items, skipped } = buildLabelItems();
    if (items.length === 0) {
      toast({ title: 'Nothing to print', description: 'Select at least one product with a valid barcode.', variant: 'destructive' });
      return;
    }
    setIsBuilding('print');
    try {
      const html = buildPrintHTML(items, size, showName, showPrice, paperType);
      const win = window.open('', '_blank', 'width=500,height=400,left=200,top=100');
      if (!win) {
        alert('Pop-up blocked. Please allow pop-ups for this site to print barcodes.');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      if (skipped > 0) {
        toast({ title: 'Some products skipped', description: `${skipped} product(s) had no barcode/SKU and were skipped.` });
      }
    } finally {
      setIsBuilding(null);
    }
  };

  const handleExportPDF = async () => {
    const { items, skipped } = buildLabelItems();
    if (items.length === 0) {
      toast({ title: 'Nothing to export', description: 'Select at least one product with a valid barcode.', variant: 'destructive' });
      return;
    }
    setIsBuilding('pdf');
    try {
      const doc = await buildPrintPDF(items, size, showName, showPrice, paperType);
      doc.save(`Barcode-Labels-${category}.pdf`);
      if (skipped > 0) {
        toast({ title: 'Some products skipped', description: `${skipped} product(s) had no barcode/SKU and were skipped.` });
      }
    } finally {
      setIsBuilding(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Tags className="h-8 w-8" />
          Print Barcode Labels
        </h2>
        <p className="text-muted-foreground">
          Bulk-print or export barcode labels for every product in a category.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose a Category</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="grid gap-1.5 flex-1 max-w-sm">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory} disabled={loadingCategories}>
              <SelectTrigger>
                <SelectValue placeholder={loadingCategories ? 'Loading...' : 'Select a category'} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={loadProducts} disabled={!category || loadingProducts}>
            {loadingProducts ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Load Products
          </Button>
        </CardContent>
      </Card>

      {products.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Select Products</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                      </TableHead>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Barcode / SKU</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                        </TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.barcode || p.sku || '-'}</TableCell>
                        <TableCell className="text-right">
                          {typeof p.price === 'number' ? `₱${p.price.toFixed(2)}` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {selected.size} of {products.length} selected
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Label Options</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label>Paper Type</Label>
                <Select value={paperType} onValueChange={(v) => setPaperType(v as PaperType)}>
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

              <div className="grid gap-1.5">
                <Label htmlFor="qty-per-product">Qty per Product</Label>
                <Input
                  id="qty-per-product"
                  type="number"
                  min={1}
                  max={500}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(500, Number(e.target.value))))}
                />
              </div>

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
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input type="checkbox" checked={includeUnits} onChange={(e) => setIncludeUnits(e.target.checked)} />
                    Include selling-unit barcodes
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleExportPDF}
              disabled={selected.size === 0 || isBuilding !== null}
              className="gap-2"
            >
              {isBuilding === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download PDF
            </Button>
            <Button
              onClick={handlePrint}
              disabled={selected.size === 0 || isBuilding !== null}
              className="gap-2"
            >
              {isBuilding === 'print' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Print {selected.size > 0 ? `${selected.size} Product${selected.size !== 1 ? 's' : ''}` : ''}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
