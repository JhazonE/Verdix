'use client';

import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Category } from '@/lib/types';

import { useSubcategoryForm, type SubcategorySaveHandler } from './use-subcategory-form';

export function SubcategoryDialog({
  subcategory,
  categories,
  onSave,
  children,
  disabled,
}: {
  subcategory?: Category & { categoryId?: string | null };
  categories: Category[];
  onSave: SubcategorySaveHandler;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { isOpen, setIsOpen, name, setName, categoryId, setCategoryId, isSaving, handleSave } =
    useSubcategoryForm({ subcategory, onSave });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild disabled={disabled}>{children}</DialogTrigger>
      <DialogContent className="z-[100] sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{subcategory ? 'Edit Subcategory' : 'Add New Subcategory'}</DialogTitle>
          <DialogDescription>
            {subcategory ? `Editing the subcategory "${subcategory.name}".` : 'Enter the name for the new subcategory.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="subcategory-category" className="text-right">
              Category
            </Label>
            <div className="col-span-3">
              <Select value={categoryId ?? undefined} onValueChange={(v) => setCategoryId(v)}>
                <SelectTrigger id="subcategory-category">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="col-span-3"
              placeholder="e.g., Gaming Mice"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim() || !categoryId}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaving ? 'Saving...' : 'Save Subcategory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
