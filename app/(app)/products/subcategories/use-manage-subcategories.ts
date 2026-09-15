'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import type { Category } from '@/lib/types';

import { addSubcategory, deleteSubcategory, getCategories, getSubcategories, updateSubcategory } from '../actions';

export interface UseManageSubcategoriesProps {
  onSubcategoryAdded?: () => void;
}

/**
 * Controller for the Manage Subcategories list: loads categories +
 * subcategories and exposes the add/update/delete handlers (data + toasts).
 */
export function useManageSubcategories({ onSubcategoryAdded }: UseManageSubcategoriesProps) {
  const [subcategories, setSubcategories] = useState<(Category & { categoryId: string | null })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadSubcategories = async () => {
    const [subs, cats] = await Promise.all([getSubcategories(), getCategories()]);
    setSubcategories(subs as (Category & { categoryId: string | null })[]);
    setCategories(cats);
    setIsLoading(false);
  };

  useEffect(() => {
    loadSubcategories();
  }, []);

  const handleAddSubcategory = async (name: string, categoryId: string | null) => {
    const result = await addSubcategory(name, categoryId);
    if (result.success) {
      loadSubcategories();
      onSubcategoryAdded?.();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  const handleUpdateSubcategory = async (id: string, name: string, categoryId: string | null) => {
    const result = await updateSubcategory(id, name, categoryId);
    if (result.success) {
      toast({ title: 'Subcategory Updated', description: result.message });
      loadSubcategories();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  const handleDeleteSubcategory = async (id: string) => {
    const result = await deleteSubcategory(id);
    if (result.success) {
      toast({ title: 'Subcategory Deleted', description: result.message });
      loadSubcategories();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  return {
    subcategories,
    categories,
    isLoading,
    handleAddSubcategory,
    handleUpdateSubcategory,
    handleDeleteSubcategory,
  };
}
