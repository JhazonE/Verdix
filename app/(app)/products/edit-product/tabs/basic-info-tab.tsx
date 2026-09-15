'use client';

import { Badge } from '@/components/ui/badge';
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Category, Brand } from '@/lib/types';

import { useEditProductFormContext } from '../edit-product-form-context';
import { InlineEditableSelect } from '../../components/inline-editable-select';
import { addBrand, updateBrand, addCategory, updateCategory, addSubcategory, updateSubcategory } from '../../actions';

export function BasicInfoTab() {
  const {
    form,
    product,
    brands,
    categories,
    subcategories,
    setSelects,
    selects,
    refreshBrands,
    refreshCategories,
    refreshSubcategories,
  } = useEditProductFormContext();

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Product Type:</span>
        <Badge variant="secondary">
          {product.type === 'service' ? 'Service' : 'Standard'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Cannot be changed after creation.
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Product Name</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
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
                isLoading={false}
                value={field.value}
                onChange={field.onChange}
                open={selects.brands}
                onOpenChange={(o) => setSelects((p) => ({ ...p, brands: o }))}
                placeholder="Select a brand"
                addLabel="Add Brand"
                emptyLabel="No brands found"
                orphanLabel={(v) => `${v} (Missing in Settings)`}
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
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="sku"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SKU</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} readOnly className="bg-muted" />
              </FormControl>
              <FormDescription>SKU cannot be changed after creation.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <InlineEditableSelect
                items={categories}
                isLoading={false}
                value={field.value}
                onChange={field.onChange}
                open={selects.categories}
                onOpenChange={(o) => setSelects((p) => ({ ...p, categories: o }))}
                placeholder="Select a category"
                addLabel="Add Category"
                emptyLabel="No categories found"
                orphanLabel={(v) => `${v} (Missing in Settings)`}
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
      </div>
      {/* Subcategory has no natural partner, so it spans the full width
          instead of leaving an empty half-row beside it. */}
      <FormField
        control={form.control}
        name="subcategory"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Subcategory (Optional)</FormLabel>
            <InlineEditableSelect
              items={subcategories}
              isLoading={false}
              value={field.value}
              onChange={field.onChange}
              open={selects.subcategories}
              onOpenChange={(o) => setSelects((p) => ({ ...p, subcategories: o }))}
              placeholder="Select a subcategory"
              addLabel="Add Subcategory"
              emptyLabel="No subcategories found"
              orphanLabel={(v) => `${v} (Missing in Settings)`}
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
    </>
  );
}
