'use client';

import { Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Category, Brand } from '@/lib/types';

import { useAddProductFormContext } from '../add-product-form-context';
import { InlineEditableSelect } from '../../components/inline-editable-select';
import { addBrand, updateBrand, addCategory, updateCategory, addSubcategory, updateSubcategory } from '../../actions';

export function BasicInfoTab() {
  const {
    form,
    brands, isLoadingBrands,
    categories, isLoadingCategories,
    subcategories, isLoadingSubcategories,
    selects, setSelects,
    refreshBrands,
    refreshCategories,
    refreshSubcategories,
    generateSku,
  } = useAddProductFormContext();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Row 1: Name and Brand */}
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem className="col-span-2 sm:col-span-1">
            <FormLabel>Product Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g., Cola-Cola" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="brand"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Brand</FormLabel>
            <InlineEditableSelect
              items={brands}
              isLoading={isLoadingBrands}
              value={field.value}
              onChange={field.onChange}
              open={selects.brands}
              onOpenChange={(o) => setSelects((p) => ({ ...p, brands: o }))}
              placeholder="Select a brand"
              addLabel="Add Brand"
              emptyLabel="No brands found"
              getId={(b: Brand) => b.id}
              getValue={(b: Brand) => b.name}
              getOptionLabel={(b: Brand) => b.name}
              getName={(b: Brand) => b.name}
              onAdd={async (name) => {
                const r = await addBrand(name, 0);
                if (r.success) { await refreshBrands(); return name; }
                return undefined;
              }}
              onRename={async (id, name) => {
                const existing = brands.find((b: Brand) => b.id === id);
                const r = await updateBrand(id, name, existing?.markupPercentage);
                if (r.success) { await refreshBrands(); return name; }
                return undefined;
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Row 2: SKU and Barcode */}
      <FormField
        control={form.control}
        name="sku"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SKU</FormLabel>
            <div className="relative">
              <FormControl>
                <Input placeholder="e.g., COKE-PC" {...field} className="pr-10" />
              </FormControl>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                onClick={generateSku}
              >
                <Wand2 className="h-4 w-4" />
                <span className="sr-only">Generate SKU</span>
              </Button>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      {/* Row 3: Description and Additional Description */}
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                placeholder="A short description of the product."
                {...field}
                onKeyDown={(e) => {
                  if (e.key === ' ') {
                    e.stopPropagation();
                  }
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="additionalDescription"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Additional Description (Optional)</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Provide additional details like specifications or special notes."
                {...field}
                onKeyDown={(e) => {
                  if (e.key === ' ') {
                    e.stopPropagation();
                  }
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Row 4: Category and Subcategory */}
      <FormField
        control={form.control}
        name="category"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Category</FormLabel>
            <InlineEditableSelect
              items={categories}
              isLoading={isLoadingCategories}
              value={field.value}
              onChange={field.onChange}
              open={selects.categories}
              onOpenChange={(o) => setSelects((p) => ({ ...p, categories: o }))}
              placeholder="Select a category"
              addLabel="Add Category"
              emptyLabel="No categories found"
              getId={(c: Category) => c.id}
              getValue={(c: Category) => c.name}
              getOptionLabel={(c: Category) => c.name}
              getName={(c: Category) => c.name}
              onAdd={async (name) => {
                const r = await addCategory(name, 0);
                if (r.success) { await refreshCategories(); return name; }
                return undefined;
              }}
              onRename={async (id, name) => {
                const existing = categories.find((c: Category) => c.id === id);
                const r = await updateCategory(id, name, existing?.markupPercentage);
                if (r.success) { await refreshCategories(); return name; }
                return undefined;
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="subcategory"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Subcategory (Optional)</FormLabel>
            <InlineEditableSelect
              items={subcategories}
              isLoading={isLoadingSubcategories}
              value={field.value}
              onChange={field.onChange}
              open={selects.subcategories}
              onOpenChange={(o) => setSelects((p) => ({ ...p, subcategories: o }))}
              placeholder="Select a subcategory"
              addLabel="Add Subcategory"
              emptyLabel="No subcategories found"
              getId={(s: Category) => s.id}
              getValue={(s: Category) => s.name}
              getOptionLabel={(s: Category) => s.name}
              getName={(s: Category) => s.name}
              onAdd={async (name) => {
                const r = await addSubcategory(name, 0);
                if (r.success) { await refreshSubcategories(); return name; }
                return undefined;
              }}
              onRename={async (id, name) => {
                const existing = subcategories.find((s: Category) => s.id === id);
                const r = await updateSubcategory(id, name, existing?.markupPercentage);
                if (r.success) { await refreshSubcategories(); return name; }
                return undefined;
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
