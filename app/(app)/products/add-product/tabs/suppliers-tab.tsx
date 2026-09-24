'use client';

import { useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PlusCircle, Trash2, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SupplierProductMapping } from '@/lib/types';

import { AddSupplierMappingDialog } from '../../supplier-mapping/AddSupplierMappingDialog';
import { useAddProductFormContext } from '../add-product-form-context';

/**
 * Suppliers tab for a product that doesn't exist yet. Unlike the Edit
 * Product version (ProductSuppliers, which reads/writes supplier_product_mapping
 * live via server actions), rows here live in the form's own `supplierMappings`
 * field array and are only persisted when the whole product is submitted —
 * addProduct writes them in the same transaction it creates the product in.
 *
 * Reuses AddSupplierMappingDialog in its "local mode": passing productId="new"
 * makes its onSubmit hand the row back via onSuccess(data) instead of calling
 * addSupplierMapping/updateSupplierMapping (see use-supplier-mapping-form.ts).
 */
export function SuppliersTab() {
  const {
    suppliers,
    supplierMappingFields,
    appendSupplierMapping,
    removeSupplierMapping,
    updateSupplierMappingField,
    refreshSuppliers,
  } = useAddProductFormContext();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleOpenDialog = (index?: number) => {
    setEditingIndex(index ?? null);
    setIsDialogOpen(true);
  };

  const editingRow = editingIndex !== null ? supplierMappingFields[editingIndex] : null;
  // AddSupplierMappingDialog expects a full SupplierProductMapping shape for
  // `editingMapping` — synthesize the id/productId it never needs in local
  // mode (its onSubmit only reads the supplier/leadTime/rop/cost/sku/isPrimary
  // fields back out, see use-supplier-mapping-form.ts).
  const editingMapping: SupplierProductMapping | null = editingRow
    ? {
        id: editingRow.id,
        productId: 'new',
        supplierId: editingRow.supplierId,
        supplierSku: editingRow.supplierSku,
        supplierLeadTime: editingRow.leadTime,
        supplierSpecificRop: editingRow.rop,
        supplierCost: editingRow.cost,
        isPrimary: editingRow.isPrimary,
      }
    : null;

  const handleDialogSuccess = (data?: {
    supplierId: string;
    leadTime: number;
    rop: number;
    cost?: number;
    supplierSku?: string;
    isPrimary: boolean;
  }) => {
    if (!data) return;

    // A product's first supplier mapping is always primary — same rule
    // addSupplierMapping enforces server-side for Edit Product (see
    // actions.ts). Only applies when adding a brand-new row (editingIndex is
    // null) into a currently-empty array; editing an existing row leaves
    // whatever primary flag the user picked in the dialog.
    const isAddingFirstRow = editingIndex === null && supplierMappingFields.length === 0;
    const resolvedData = isAddingFirstRow ? { ...data, isPrimary: true } : data;

    // Only one mapping can be primary — clear any existing flag first, same
    // as setPrimarySupplier enforces server-side for an existing product.
    if (resolvedData.isPrimary) {
      supplierMappingFields.forEach((row, i) => {
        if (i !== editingIndex && row.isPrimary) {
          updateSupplierMappingField(i, { ...row, isPrimary: false });
        }
      });
    }

    if (editingIndex !== null) {
      updateSupplierMappingField(editingIndex, { ...supplierMappingFields[editingIndex], ...resolvedData });
    } else {
      appendSupplierMapping(resolvedData);
    }
    setEditingIndex(null);
  };

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Unknown supplier';

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Supplier Mappings</h3>
          <p className="text-sm text-muted-foreground">
            Optional — track per-supplier SKU, lead time, reorder point, and cost for this product.
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()} size="sm" type="button">
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Lead Time (Days)</TableHead>
              <TableHead>ROP</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplierMappingFields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No suppliers mapped yet.
                </TableCell>
              </TableRow>
            ) : (
              supplierMappingFields.map((row, index) => (
                <TableRow key={row.id} className={row.isPrimary ? 'bg-muted/30' : ''}>
                  <TableCell>
                    {row.isPrimary && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                          </TooltipTrigger>
                          <TooltipContent>Primary Supplier</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {supplierName(row.supplierId)}
                    {row.isPrimary && <Badge variant="secondary" className="ml-2 text-xs">Primary</Badge>}
                  </TableCell>
                  <TableCell>{row.supplierSku || '-'}</TableCell>
                  <TableCell>{row.leadTime} days</TableCell>
                  <TableCell>{row.rop}</TableCell>
                  <TableCell className="text-right">{row.cost != null ? `₱${row.cost.toFixed(2)}` : '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(index)} type="button">
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeSupplierMapping(index)} type="button">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AddSupplierMappingDialog
        productId="new"
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSuccess={handleDialogSuccess}
        editingMapping={editingMapping}
        suppliers={suppliers}
        onRefreshSuppliers={refreshSuppliers}
      />
    </div>
  );
}
