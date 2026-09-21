'use client';

import { UseFormReturn, FieldArrayWithId } from 'react-hook-form';
import { FormControl, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Search } from 'lucide-react';
import { formatQuantity } from '@/lib/utils';
import { abbreviateUOM } from '@/lib/receipt-uom';
import type { Product } from '@/lib/types';
import type { SalesInvoiceFormValues } from './add-invoice-types';
import { AddInvoiceProductSelector } from './AddInvoiceProductSelector';

type Props = {
  form: UseFormReturn<SalesInvoiceFormValues>;
  fields: FieldArrayWithId<SalesInvoiceFormValues, 'items'>[];
  remove: (index: number) => void;
  total: number;
  vatAmount: number;
  handleAddProduct: (product: Product, unit?: { id?: string; name: string; factor: number; price: number }) => void;
};

export function AddInvoiceItemsTable({ form, fields, remove, total, vatAmount, handleAddProduct }: Props) {
  const warehouseId = form.watch('warehouse');
  const shipping = Number(form.watch('shipping') || 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-muted/5 p-3 relative">
      <div className="max-w-2xl mb-3 z-10 shrink-0">
        <AddInvoiceProductSelector onSelectProduct={handleAddProduct} warehouseId={warehouseId} />
      </div>

      <div className="flex-1 min-h-0 rounded-lg border bg-background shadow-sm overflow-hidden flex flex-col relative">
        <div className="overflow-y-auto flex-1 min-h-0 relative">
          <table className="w-full caption-bottom text-sm text-left border-collapse">
            <TableHeader className="sticky top-0 bg-background z-50 shadow-sm">
              <TableRow className="hover:bg-transparent border-b">
                <TableHead className="w-[36%] pl-4 h-10">Product</TableHead>
                <TableHead className="w-[13%] text-center h-10">Qty</TableHead>
                <TableHead className="w-[17%] text-right h-10">Price</TableHead>
                <TableHead className="w-[17%] text-right pr-4 h-10">Total</TableHead>
                <TableHead className="w-[12%] text-center h-10">VAT</TableHead>
                <TableHead className="w-[5%] h-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-[calc(100vh-420px)] min-h-[300px] text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="bg-muted p-4 rounded-full"><Search className="h-8 w-8 opacity-20" /></div>
                      <p className="font-medium">No items added</p>
                      <p className="text-xs text-muted-foreground">Scan barcode or search above to add products.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                fields.map((field, index) => (
                  <TableRow key={field.id} className="group hover:bg-muted/50 border-b">
                    <TableCell className="font-medium pl-4 py-2">
                      <div className="font-medium">
                        {field.product.name}
                        {field.sellingUnitName && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">({abbreviateUOM(field.sellingUnitName)})</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-2">
                        <span>{field.product.sku || 'No SKU'}</span>
                        {field.product.stock !== undefined && (
                          <span className={field.product.stock <= 0 ? 'text-destructive' : 'text-emerald-600'}>
                            Stock: {formatQuantity(field.product.stock)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex justify-center">
                        <FormField
                          control={form.control}
                          name={`items.${index}.quantity`}
                          render={({ field }) => (
                            <Input type="number" className="h-8 w-20 text-center bg-background" {...field} onFocus={e => e.target.select()} />
                          )}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <FormField
                        control={form.control}
                        name={`items.${index}.price`}
                        render={({ field }) => (
                          <Input type="number" step="0.01" className="h-8 w-24 text-right ml-auto border-transparent hover:border-input focus:border-input bg-background" {...field} />
                        )}
                      />
                    </TableCell>
                    <TableCell className="text-right py-2 pr-4 font-mono">
                      ₱{(Number(form.watch(`items.${index}.price`) || 0) * Number(form.watch(`items.${index}.quantity`) || 0)).toFixed(2)}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex justify-center">
                        <FormField
                          control={form.control}
                          name={`items.${index}.vatable`}
                          render={({ field }) => (
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => field.onChange(checked === true)}
                              aria-label="Subject to VAT"
                            />
                          )}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Button
                        variant="ghost" size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>

        <div className="shrink-0 bg-muted/30 px-4 py-2 border-t flex items-center justify-end gap-6">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>₱{(Number(total) - shipping - vatAmount).toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">VAT (12%)</span>
            <span>₱{vatAmount.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Shipping</span>
            <span>₱{shipping.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1.5 pl-4 border-l">
            <span className="font-semibold">Total</span>
            <span className="font-bold text-lg text-primary">₱{Number(total).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
