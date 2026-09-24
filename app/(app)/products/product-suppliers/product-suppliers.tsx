'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PlusCircle, Trash2, Star, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

import type { SupplierProductMapping } from '@/lib/types';
import { AddSupplierMappingDialog } from '../supplier-mapping/AddSupplierMappingDialog';
import { useProductSuppliers } from './use-product-suppliers';

export function ProductSuppliers({
  productId,
  onUpdate,
  mappings,
  isLoadingMappings,
  onMappingsChanged,
}: {
  productId: string;
  onUpdate?: () => void;
  mappings?: SupplierProductMapping[];
  isLoadingMappings?: boolean;
  onMappingsChanged?: () => void | Promise<void>;
}) {
  const {
    mappings: resolvedMappings,
    suppliers,
    isLoading,
    isDialogOpen,
    setIsDialogOpen,
    editingMapping,
    confirmPrimaryOpen,
    setConfirmPrimaryOpen,
    loadData,
    handleOpenDialog,
    handleDelete,
    initiateSetPrimary,
    confirmSetPrimary,
  } = useProductSuppliers({ productId, onUpdate, mappings, isLoadingMappings, onMappingsChanged });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Supplier Mappings</h3>
          <p className="text-sm text-muted-foreground">
            Manage suppliers, lead times, and reorder points for this product.
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
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : resolvedMappings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No suppliers mapped yet.
                </TableCell>
              </TableRow>
            ) : (
              resolvedMappings.map((mapping) => (
                <TableRow key={mapping.id} className={mapping.isPrimary ? 'bg-muted/30' : ''}>
                  <TableCell>
                    {mapping.isPrimary ? (
                      <TooltipProvider>
                         <Tooltip>
                            <TooltipTrigger>
                                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                            </TooltipTrigger>
                            <TooltipContent>Primary Supplier</TooltipContent>
                         </Tooltip>
                      </TooltipProvider>
                    ) : (
                       <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-20 hover:opacity-100" onClick={() => initiateSetPrimary(mapping.id)} type="button">
                           <Star className="h-4 w-4" />
                       </Button>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    {mapping.supplierName}
                    {mapping.isPrimary && <Badge variant="secondary" className="ml-2 text-xs">Primary</Badge>}
                  </TableCell>
                  <TableCell>{mapping.supplierSku || '-'}</TableCell>
                  <TableCell>{mapping.supplierLeadTime} days</TableCell>
                  <TableCell>{mapping.supplierSpecificRop}</TableCell>
                  <TableCell className="text-right">₱{mapping.supplierCost?.toFixed(2) || '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(mapping)} type="button">
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(mapping.id)} type="button">
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
        productId={productId}
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSuccess={() => {
            loadData();
            onUpdate?.();
        }}
        editingMapping={editingMapping}
        suppliers={suppliers}
        onRefreshSuppliers={loadData}
      />

      <AlertDialog open={confirmPrimaryOpen} onOpenChange={setConfirmPrimaryOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Primary Supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              Changing the primary supplier will update the effective Reorder Point (ROP) for this product based on the new supplier's lead time and ROP settings.
              <br /><br />
              Please confirm that you have validated the ROP and Lead Time for this supplier.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSetPrimary}>Confirm Change</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
