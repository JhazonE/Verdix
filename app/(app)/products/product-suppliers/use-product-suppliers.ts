'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { SupplierProductMapping, Supplier } from '@/lib/types';

import {
  deleteSupplierMapping,
  getSupplierMappings,
  getSuppliers,
  setPrimarySupplier,
} from '../actions';

export interface UseProductSuppliersProps {
  productId: string;
  onUpdate?: () => void;
  /**
   * When supplied (Edit Product does, via useEditProductForm — see Task 4),
   * this hook uses these instead of fetching its own copy, so the markup and
   * selling-unit-cost suggestion effects in useEditProductForm and this
   * tab's CRUD UI always agree on the same primary mapping. When omitted,
   * this hook fetches and owns the data itself (kept for any other caller).
   */
  mappings?: SupplierProductMapping[];
  isLoadingMappings?: boolean;
  onMappingsChanged?: () => void | Promise<void>;
}

/**
 * Controller for the product supplier mappings panel: loads mappings/suppliers
 * and owns the add/edit dialog state plus the delete and set-primary flows.
 */
export function useProductSuppliers({
  productId,
  onUpdate,
  mappings: externalMappings,
  isLoadingMappings: externalIsLoading,
  onMappingsChanged,
}: UseProductSuppliersProps) {
  const [internalMappings, setInternalMappings] = useState<SupplierProductMapping[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [internalIsLoading, setInternalIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<SupplierProductMapping | null>(null);
  const [confirmPrimaryOpen, setConfirmPrimaryOpen] = useState(false);
  const [pendingPrimaryId, setPendingPrimaryId] = useState<string | null>(null);
  const { toast } = useToast();

  const usesExternalMappings = externalMappings !== undefined;
  const mappings = usesExternalMappings ? externalMappings : internalMappings;
  const isLoading = usesExternalMappings ? !!externalIsLoading : internalIsLoading;

  const loadData = async () => {
    if (usesExternalMappings) {
      // Suppliers still needs its own fetch either way — only the mappings
      // list is shared with the parent.
      try {
        setSuppliers(await getSuppliers());
      } catch (error) {
        console.error('Failed to load suppliers', error);
      }
      await onMappingsChanged?.();
      return;
    }
    setInternalIsLoading(true);
    try {
      const [mappingsData, suppliersData] = await Promise.all([
        getSupplierMappings(productId),
        getSuppliers(),
      ]);
      setInternalMappings(mappingsData);
      setSuppliers(suppliersData);
    } catch (error) {
      console.error('Failed to load supplier data', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load supplier data.',
      });
    } finally {
      setInternalIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const handleOpenDialog = (mapping?: SupplierProductMapping) => {
    setEditingMapping(mapping ?? null);
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to remove this supplier mapping?')) {
      try {
        const result = await deleteSupplierMapping(id);
        if (result.success) {
          toast({
            title: 'Removed',
            description: result.message,
          });
          loadData();
          onUpdate?.();
        } else {
          toast({
            variant: 'destructive',
            title: 'Error',
            description: result.message,
          });
        }
      } catch (error) {
        console.error('Error deleting mapping:', error);
      }
    }
  };

  const initiateSetPrimary = (id: string) => {
    const mapping = mappings.find(m => m.id === id);
    if (!mapping) return;

    // Always prompt so the user re-validates the ROP/Lead Time before switching.
    setPendingPrimaryId(id);
    setConfirmPrimaryOpen(true);
  };

  const confirmSetPrimary = async () => {
    if (!pendingPrimaryId) return;

    try {
      const result = await setPrimarySupplier(productId, pendingPrimaryId);
      if (result.success) {
        toast({
          title: 'Primary Supplier Updated',
          description: 'The primary supplier and active ROP have been updated.',
        });
        loadData();
        onUpdate?.();
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error setting primary:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update primary supplier.',
      });
    } finally {
      setConfirmPrimaryOpen(false);
      setPendingPrimaryId(null);
    }
  };

  return {
    mappings,
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
  };
}
