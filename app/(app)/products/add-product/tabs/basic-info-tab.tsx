'use client';

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Category, Brand } from '@/lib/types';

import { useAddProductFormContext } from '../add-product-form-context';
import { InlineEditableSelect } from '../../components/inline-editable-select';
import { CategorySubcategorySelect } from '../../components/category-subcategory-select';
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
  } = useAddProductFormContext();

  const watchedCategoryName = form.watch('category');
  const watchedSubcategoryName = form.watch('subcategory');

  return (
    <div className="space-y-4">
      {/* Row 1: Name and Brand — the two "identity" fields. Each row is its
          own grid so a tall field (e.g. a textarea) never stretches an
          unrelated row's fields to match its height — CSS grid rows
          spanning one flat container share a row track height with
          whatever else auto-flowed into that row. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
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
                  return { error: r.message };
                }}
                onRename={async (id, name) => {
                  const existing = brands.find((b: Brand) => b.id === id);
                  const r = await updateBrand(id, name, existing?.markupPercentage);
                  if (r.success) { await refreshBrands(); return name; }
                  return { error: r.message };
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Category and Subcategory are ONE field: picking a subcategory
          resolves its parent category automatically, picking a category
          clears any subcategory. See category-subcategory-select.tsx.
          Still wrapped in FormField (rather than a bare FormItem) even
          though the picker doesn't use RHF's `field` render-prop directly —
          FormMessage below calls useFormField(), which throws outside a
          FormField/FormItem context pair (the exact crash this app hit
          earlier when a couple of disabled display fields skipped this). */}
      <FormField
        control={form.control}
        name="category"
        render={() => (
          <FormItem>
            <FormLabel>Category</FormLabel>
            <CategorySubcategorySelect
              categories={categories}
              subcategories={subcategories as any}
              isLoading={isLoadingCategories || isLoadingSubcategories}
              categoryValue={watchedCategoryName}
              subcategoryValue={watchedSubcategoryName ?? ''}
              onChange={(categoryName, subcategoryName) => {
                form.setValue('category', categoryName, { shouldValidate: true });
                form.setValue('subcategory', subcategoryName);
              }}
              open={selects.categories}
              onOpenChange={(o) => setSelects((p) => ({ ...p, categories: o }))}
              onAddCategory={async (name) => {
                const r = await addCategory(name, 0);
                if (r.success) { await refreshCategories(); return name; }
                return { error: r.message };
              }}
              onRenameCategory={async (id, name) => {
                const existing = categories.find((c: Category) => c.id === id);
                const r = await updateCategory(id, name, existing?.markupPercentage);
                if (r.success) { await refreshCategories(); return name; }
                return { error: r.message };
              }}
              onAddSubcategory={async (name, categoryId) => {
                const r = await addSubcategory(name, categoryId, 0);
                if (r.success) { await refreshSubcategories(); return name; }
                return { error: r.message };
              }}
              onRenameSubcategory={async (id, name) => {
                const existing: any = subcategories.find((s: Category) => s.id === id);
                const r = await updateSubcategory(id, name, existing?.categoryId ?? null, existing?.markupPercentage);
                if (r.success) { await refreshSubcategories(); return name; }
                return { error: r.message };
              }}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Row 4: Description and Additional Description — both textareas. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </div>
    </div>
  );
}
