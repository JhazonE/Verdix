'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { SupplierProductMapping } from '@/lib/types';

import { addSupplierMapping, updateSupplierMapping } from '../actions';

// Supplier SKU is a freeform, per-supplier code (unlike the retired products.sku),
// so a collision here is harmless — this only fills the field when left blank.
function generateSupplierSku(): string {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SUP-${randomPart}`;
}

export interface UseSupplierMappingFormProps {
  productId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (data?: any) => void;
  editingMapping: SupplierProductMapping | null;
}

/**
 * Controller for the add/edit supplier mapping dialog: holds the field state,
 * (re)initialises it when the dialog opens, and runs the submit/validation
 * flow so the dialog stays presentational.
 */
export function useSupplierMappingForm({
  productId,
  isOpen,
  onOpenChange,
  onSuccess,
  editingMapping,
}: UseSupplierMappingFormProps) {
  const { toast } = useToast();

  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [leadTime, setLeadTime] = useState('');
  const [rop, setRop] = useState('');
  const [cost, setCost] = useState('');
  const [supplierSku, setSupplierSku] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form when opening
  useEffect(() => {
    if (isOpen) {
      if (editingMapping) {
        setSelectedSupplier(editingMapping.supplierId);
        setLeadTime(editingMapping.supplierLeadTime.toString());
        setRop(editingMapping.supplierSpecificRop.toString());
        setCost(editingMapping.supplierCost?.toString() || '');
        setSupplierSku(editingMapping.supplierSku || '');
        setIsPrimary(editingMapping.isPrimary);
      } else {
        // Reset defaults for new mapping
        setSelectedSupplier('');
        setLeadTime('');
        setRop('');
        setCost('');
        setSupplierSku(generateSupplierSku());
        setIsPrimary(false);
      }
    }
  }, [isOpen, editingMapping]);

  const onSubmit = async () => {
    if (!selectedSupplier || !leadTime || !rop) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Supplier, Lead Time, and ROP are required.',
      });
      return;
    }

    const finalSupplierSku = supplierSku.trim() || generateSupplierSku();

    const mappingData = {
      supplierId: selectedSupplier,
      leadTime: parseInt(leadTime),
      rop: parseInt(rop),
      cost: cost ? parseFloat(cost) : undefined,
      supplierSku: finalSupplierSku,
      isPrimary,
    };

    if (productId === 'new' && onSuccess) {
      // Local mode: hand the data back to the parent instead of persisting.
      onSuccess(mappingData);
      onOpenChange(false);
      return;
    }

    setIsSubmitting(true);
    try {
      let result;
      if (editingMapping && editingMapping.id && productId !== 'new') {
        result = await updateSupplierMapping(
          editingMapping.id,
          parseInt(leadTime),
          parseInt(rop),
          cost ? parseFloat(cost) : undefined,
          finalSupplierSku,
          isPrimary
        );
      } else {
        result = await addSupplierMapping(
          productId,
          selectedSupplier,
          parseInt(leadTime),
          parseInt(rop),
          cost ? parseFloat(cost) : undefined,
          finalSupplierSku,
          isPrimary
        );
      }

      if (result.success) {
        toast({
          title: 'Success',
          description: result.message,
        });
        onOpenChange(false);
        onSuccess();
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error saving mapping:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'An unexpected error occurred.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
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
    isPrimary,
    setIsPrimary,
    isSubmitting,
    onSubmit,
  };
}
