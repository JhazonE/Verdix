'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEffect, useState } from 'react';
import { Check, PlusCircle, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SupplierProductMapping, Supplier } from '@/lib/types';

import { addSupplier } from '../actions';
import { useSupplierMappingForm } from './use-supplier-mapping-form';

interface AddSupplierMappingDialogProps {
  productId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (data?: any) => void;
  editingMapping: SupplierProductMapping | null;
  suppliers: Supplier[];
  onRefreshSuppliers: () => void;
}

export function AddSupplierMappingDialog({
  productId,
  isOpen,
  onOpenChange,
  onSuccess,
  editingMapping,
  suppliers,
  onRefreshSuppliers,
}: AddSupplierMappingDialogProps) {
  const {
    selectedSupplier,
    setSelectedSupplier,
    leadTime,
    setLeadTime,
    rop,
    setRop,
    cost,
    setCost,
    supplierSku,
    setSupplierSku,
    isSubmitting,
    onSubmit,
  } = useSupplierMappingForm({ productId, isOpen, onOpenChange, onSuccess, editingMapping });

  // Inline "Add New Supplier": swaps the Select for a name field in place, so no
  // second drawer opens on top of this dialog. Only the name is captured here;
  // the rest of the supplier's details can be filled in from Manage Suppliers.
  const [isAddingSupplier, setIsAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!isOpen) {
      setIsAddingSupplier(false);
      setNewSupplierName('');
    }
  }, [isOpen]);

  const cancelAddSupplier = () => {
    setIsAddingSupplier(false);
    setNewSupplierName('');
  };

  const handleSaveNewSupplier = async () => {
    const name = newSupplierName.trim();
    if (!name) return;
    setIsSavingSupplier(true);
    try {
      const result = await addSupplier({ name, paymentTerms: 'CASH' });
      if (result.success && 'id' in result && result.id) {
        onRefreshSuppliers();
        setSelectedSupplier(result.id);
        setIsSelectOpen(false);
        cancelAddSupplier();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (error) {
      console.error('Failed to add supplier', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to add supplier.' });
    } finally {
      setIsSavingSupplier(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{editingMapping ? 'Edit Mapping' : 'Add Supplier Mapping'}</DialogTitle>
          <DialogDescription>
            Configure supplier specific details.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="supplier">Supplier</Label>
            <Select
              value={selectedSupplier}
              onValueChange={setSelectedSupplier}
              disabled={!!editingMapping}
              open={isSelectOpen}
              onOpenChange={open => {
                setIsSelectOpen(open);
                if (!open) cancelAddSupplier();
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
                {!editingMapping && (
                  <div className="p-1 w-full border-t mt-1">
                    {isAddingSupplier ? (
                      // Keydown/pointer events are stopped so Select's typeahead and
                      // item-focus handling don't steal focus from the input.
                      <div
                        className="flex items-center gap-1.5 px-0.5"
                        onKeyDown={e => e.stopPropagation()}
                        onPointerMove={e => e.stopPropagation()}
                      >
                        <Input
                          autoFocus
                          className="h-8 min-w-0 flex-1"
                          value={newSupplierName}
                          onChange={e => setNewSupplierName(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter') { e.preventDefault(); handleSaveNewSupplier(); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelAddSupplier(); }
                          }}
                          placeholder="New supplier name"
                          disabled={isSavingSupplier}
                        />
                        <Button type="button" size="icon" className="h-8 w-8 shrink-0" onClick={handleSaveNewSupplier} disabled={isSavingSupplier || !newSupplierName.trim()} aria-label="Save supplier">
                          {isSavingSupplier ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={cancelAddSupplier} disabled={isSavingSupplier} aria-label="Cancel">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        className="w-full justify-start font-normal h-8"
                        onClick={() => setIsAddingSupplier(true)}
                      >
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add New Supplier
                      </Button>
                    )}
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="leadTime">Lead Time (Days)</Label>
                <Input id="leadTime" type="number" value={leadTime} onChange={e => setLeadTime(e.target.value)} placeholder="e.g. 7" />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="rop">Reorder Point</Label>
                <Input id="rop" type="number" value={rop} onChange={e => setRop(e.target.value)} placeholder="e.g. 50" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                  <Label htmlFor="cost">Cost (₱)</Label>
                  <Input id="cost" type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} placeholder="e.g. 100.00" />
              </div>
              <div className="grid gap-2">
                  <Label htmlFor="supplierSku">Supplier SKU</Label>
                  <Input id="supplierSku" value={supplierSku} onChange={e => setSupplierSku(e.target.value)} placeholder="Optional" />
              </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
