'use client';

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { UnitOfMeasure } from '@/lib/types';
import type { Supplier } from '@/lib/types';

import { useEditProductFormContext } from '../edit-product-form-context';
import { InlineEditableSelect } from '../../components/inline-editable-select';
import { InlineEditableMultiSelect } from '../../components/inline-editable-multi-select';
import {
  addDepartment, updateDepartment,
  addSupplier, updateSupplier, getSuppliers,
  addShelfLocation, updateShelfLocation, getShelfLocations,
  addUnitOfMeasure, updateUnitOfMeasure,
} from '../../actions';

export function InventoryTab() {
  const {
    form,
    product,
    departments, isLoadingDepartments,
    taxRates,
    suppliers,
    warehouses,
    shelfLocations,
    units,
    selects, setSelects,
    refreshDepartments,
    refreshSuppliers,
    refreshShelfLocations,
    refreshUnits,
  } = useEditProductFormContext();

  // Derived from the saved product, not from state: type is immutable after
  // creation, so editing a service must show the same fields the Add form
  // shows when Service is selected.
  const isServiceProduct = product?.type === 'service';

  if (isServiceProduct) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="vatStatus"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">VAT Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} defaultValue="YES (Subject to 12% VAT)">
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select VAT status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {taxRates.map((rate) => (
                    <SelectItem key={rate.id} value={rate.name}>
                      {rate.name} {rate.rate > 0 ? `(${rate.rate}%)` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="availability"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">Availability</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} defaultValue="Available">
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select availability" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="Unavailable">Unavailable</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="unitOfMeasure"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center" required>Base Unit of Measure</FormLabel>
              <InlineEditableSelect
                items={units}
                isLoading={false}
                value={field.value}
                onChange={field.onChange}
                open={selects.units}
                onOpenChange={(o) => setSelects((p) => ({ ...p, units: o }))}
                placeholder="Select a unit"
                addLabel="Add Unit"
                emptyLabel="No units found"
                getId={(u: UnitOfMeasure) => u.id}
                getValue={(u: UnitOfMeasure) => u.name}
                getOptionLabel={(u: UnitOfMeasure) => `${u.name} (${u.abbreviation})`}
                getName={(u: UnitOfMeasure) => u.name}
                onAdd={async (name) => {
                  const r = await addUnitOfMeasure(name, name);
                  if (r.success) { await refreshUnits(); return name; }
                  return { error: r.message };
                }}
                onRename={async (id, name) => {
                  const existing = units.find((u: UnitOfMeasure) => u.id === id);
                  const r = await updateUnitOfMeasure(id, name, existing?.abbreviation ?? name);
                  if (r.success) { await refreshUnits(); return name; }
                  return { error: r.message };
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="cost"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">Cost</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="e.g., 50.00" value={field.value || ''} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {!isServiceProduct && (
        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">Department</FormLabel>
              <InlineEditableSelect
                items={departments}
                isLoading={isLoadingDepartments}
                value={field.value ?? ""}
                onChange={field.onChange}
                open={selects.departments}
                onOpenChange={(o) => setSelects((p) => ({ ...p, departments: o }))}
                placeholder="Select a department"
                addLabel="Add Department"
                emptyLabel="No departments found"
                getId={(d: any) => d.id}
                getValue={(d: any) => d.name}
                getOptionLabel={(d: any) => d.name}
                getName={(d: any) => d.name}
                onAdd={async (name) => {
                  const r = await addDepartment(name, 0);
                  if (r.success) { await refreshDepartments(); return name; }
                  return { error: r.message };
                }}
                onRename={async (id, name) => {
                  const existing = departments.find((d: any) => d.id === id);
                  const r = await updateDepartment(id, name, existing?.markupPercentage);
                  if (r.success) { await refreshDepartments(); return name; }
                  return { error: r.message };
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        )}
        <FormField
          control={form.control}
          name="vatStatus"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">VAT Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} defaultValue="YES (Subject to 12% VAT)">
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select VAT status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {taxRates.map((rate) => (
                    <SelectItem key={rate.id} value={rate.name}>
                      {rate.name} {rate.rate > 0 ? `(${rate.rate}%)` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="availability"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">Availability</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} defaultValue="Available">
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select availability" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="Unavailable">Unavailable</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Warehouse and Shelf are stock-only — a service skips both. Unit of
            Measure moved to the Selling Units tab for standard items (it has
            no equivalent for a service, which has no selling units at all).

            In the SAME grid as the fields above rather than a second one of
            its own, matching the Add form: a grid that ends on an odd field
            left Availability alone on its row with a hole beside it, and the
            next grid started a fresh row underneath. One grid lets the fields
            simply flow. */}
        {!isServiceProduct && (
        <FormField
          control={form.control}
          name="warehouse"
          render={({ field }) => (
            <FormItem>
              {/* Matches the Add form's label: pinned to the same 14px line so
                  the tooltip button cannot grow it out of line with the plain
                  label beside it. */}
              <FormLabel className="flex h-4 items-center gap-1.5">
                Warehouse
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Why the warehouse cannot be changed"
                        className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
                        // A label click would focus the field.
                        onClick={(e) => e.preventDefault()}
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[260px]">
                      A product row belongs to exactly one warehouse, and this row holds that
                      location&rsquo;s own stock. Moving it here would relocate stock with no movement
                      record, so use a stock transfer instead.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </FormLabel>
              {/* Read-only, and deliberately NOT the Add form's multi-select: a
                  product row belongs to exactly one warehouse (one row per
                  warehouse — see per-warehouse product rows), and updateProduct
                  DOES write warehouse_id, so re-pointing it here would silently
                  move stock between locations without a movement record. Moving
                  stock is what a stock transfer is for. The field stays
                  registered so the submitted payload keeps the saved
                  warehouse_id. */}
              <Input
                type="text"
                value={
                  warehouses.find((w: any) => w.id === field.value)?.name ||
                  product?.warehouseName ||
                  ''
                }
                disabled
              />
              <p className="text-sm text-muted-foreground">
                Fixed after creation. Use a stock transfer to move this item.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
        )}

        {!isServiceProduct && (
        <FormField
          control={form.control}
          name="shelfLocationIds"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">Shelf Locations (Optional)</FormLabel>
              <InlineEditableMultiSelect
                items={shelfLocations || []}
                value={field.value || []}
                onChange={field.onChange}
                placeholder="Select locations..."
                searchPlaceholder="Search location..."
                addLabel="Add Shelf Location"
                emptyLabel="No location found."
                getId={(loc: any) => loc.id}
                getName={(loc: any) => loc.name}
                onAdd={async (name) => {
                  const r = await addShelfLocation(name);
                  if (r.success) {
                    await refreshShelfLocations();
                    const fresh = await getShelfLocations();
                    const created = fresh.find((l: any) => l.name === name);
                    return created?.id;
                  }
                  return { error: r.message };
                }}
                onRename={async (id, name) => {
                  const existing = (shelfLocations || []).find((l: any) => l.id === id);
                  const r = await updateShelfLocation(id, name, existing?.description);
                  if (r.success) { await refreshShelfLocations(); return id; }
                  return { error: r.message };
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        )}
      </div>
    </div>
  );
}
