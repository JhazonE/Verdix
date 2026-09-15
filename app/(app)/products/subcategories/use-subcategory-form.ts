'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { Category } from '@/lib/types';

export type SubcategorySaveHandler = (name: string, categoryId: string | null) => Promise<void>;

export interface UseSubcategoryFormProps {
  subcategory?: Category & { categoryId?: string | null };
  onSave: SubcategorySaveHandler;
}

/**
 * Controller for the add/edit subcategory dialog form: name + categoryId
 * state, reset-on-open, and the validated save flow.
 */
export function useSubcategoryForm({ subcategory, onSave }: UseSubcategoryFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(subcategory?.name || '');
  const [categoryId, setCategoryId] = useState<string | null>(subcategory?.categoryId ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setName(subcategory?.name || '');
      setCategoryId(subcategory?.categoryId ?? null);
    }
  }, [isOpen, subcategory]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Subcategory name cannot be empty.',
      });
      return;
    }
    if (!categoryId) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Select a category for this subcategory.',
      });
      return;
    }
    setIsSaving(true);
    try {
      await onSave(name, categoryId);
      toast({
        title: subcategory ? 'Subcategory Updated' : 'Subcategory Added',
        description: `Subcategory "${name}" has been successfully saved.`,
      });
      setIsOpen(false);
      if (!subcategory) { setName(''); setCategoryId(null); }
    } catch (error) {
      console.error('Failed to save subcategory', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save subcategory. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isOpen,
    setIsOpen,
    name,
    setName,
    categoryId,
    setCategoryId,
    isSaving,
    handleSave,
  };
}
