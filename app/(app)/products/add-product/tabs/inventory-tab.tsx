'use client';

import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnitOfMeasure } from '@/lib/types';
import type { Supplier } from '@/lib/types';

import { useAddProductFormContext } from '../add-product-form-context';
import { InlineEditableSelect } from '../../components/inline-editable-select';
import { InlineEditableMultiSelect } from '../../components/inline-editable-multi-select';
import {
  addDepartment, updateDepartment,
  addSupplier, updateSupplier, getSuppliers,
  addWarehouse, updateWarehouse, getWarehouses,
  addShelfLocation, updateShelfLocation, getShelfLocations,
  addUnitOfMeasure, updateUnitOfMeasure,
} from '../../actions';

export function InventoryTab() {
  const {
    form,
    productType,
    itemType,
    departments, isLoadingDepartments,
    taxRates,
    suppliers, isLoadingSuppliers,
    warehouses, isLoadingWarehouses,
    shelfLocations,
    unitsOfMeasure, isLoadingUnits,
    selects, setSelects,
    refreshDepartments,
    refreshSuppliers,
    refreshWarehouses,
    refreshShelfLocations,
    refreshUnits,
  } = useAddProductFormContext();

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department</FormLabel>
              <InlineEditableSelect
                items={departments}
                isLoading={isLoadingDepartments}
                value={field.value}
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
                  return undefined;
                }}
                onRename={async (id, name) => {
                  const existing = departments.find((d: any) => d.id === id);
                  const r = await updateDepartment(id, name, existing?.markupPercentage);
                  if (r.success) { await refreshDepartments(); return name; }
                  return undefined;
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="vatStatus"
          render={({ field }) => (
            <FormItem>
              <FormLabel>VAT Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
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
              <FormLabel>Availability</FormLabel>
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

        {itemType === 'standard' && (
          <FormField
            control={form.control}
            name="supplier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Supplier (Optional)</FormLabel>
                <InlineEditableSelect
                  items={suppliers}
                  isLoading={isLoadingSuppliers}
                  value={field.value}
                  onChange={field.onChange}
                  open={selects.suppliers}
                  onOpenChange={(o) => setSelects((p) => ({ ...p, suppliers: o }))}
                  placeholder="Select a supplier"
                  addLabel="Add Supplier"
                  emptyLabel="No suppliers found"
                  getId={(s: Supplier) => s.id}
                  getValue={(s: Supplier) => s.id}
                  getOptionLabel={(s: Supplier) => s.name}
                  getName={(s: Supplier) => s.name}
                  onAdd={async (name) => {
                    const r = await addSupplier({ name });
                    if (r.success) {
                      await refreshSuppliers();
                      const fresh = await getSuppliers();
                      const created = fresh.find((s) => s.name === name);
                      return created?.id;
                    }
                    return undefined;
                  }}
                  onRename={async (id, name) => {
                    const existing = suppliers.find((s: Supplier) => s.id === id);
                    if (!existing) return undefined;
                    const r = await updateSupplier(id, { ...existing, name });
                    if (r.success) { await refreshSuppliers(); return id; }
                    return undefined;
                  }}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>

      {/* Warehouse and Shelf are stock-only, leaving Unit of Measure alone here
          for a service. Two columns keeps it the same width as the fields
          above rather than shrinking it to a third. */}
      <div className={`grid grid-cols-1 gap-4 ${itemType === 'standard' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {itemType === 'standard' && (
          <FormField
            control={form.control}
            name="warehouse"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Warehouse (Optional)</FormLabel>
                <InlineEditableSelect
                  items={warehouses}
                  isLoading={isLoadingWarehouses}
                  value={field.value}
                  onChange={field.onChange}
                  open={selects.warehouses}
                  onOpenChange={(o) => setSelects((p) => ({ ...p, warehouses: o }))}
                  placeholder="Select a warehouse"
                  addLabel="Add Warehouse"
                  emptyLabel="No warehouses found"
                  getId={(w: any) => w.id}
                  getValue={(w: any) => w.id}
                  getOptionLabel={(w: any) => w.name}
                  getName={(w: any) => w.name}
                  onAdd={async (name) => {
                    const r = await addWarehouse(name);
                    if (r.success) {
                      await refreshWarehouses();
                      const fresh = await getWarehouses();
                      const created = fresh.find((w: any) => w.name === name);
                      return created?.id;
                    }
                    return undefined;
                  }}
                  onRename={async (id, name) => {
                    const existing = warehouses.find((w: any) => w.id === id);
                    const r = await updateWarehouse(id, name, existing?.location);
                    if (r.success) { await refreshWarehouses(); return id; }
                    return undefined;
                  }}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {itemType === 'standard' && (
          <FormField
            control={form.control}
            name="shelfLocationIds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Shelf Locations (Optional)</FormLabel>
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
                    return undefined;
                  }}
                  onRename={async (id, name) => {
                    const existing = (shelfLocations || []).find((l: any) => l.id === id);
                    const r = await updateShelfLocation(id, name, existing?.description);
                    if (r.success) { await refreshShelfLocations(); return id; }
                    return undefined;
                  }}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="unitOfMeasure"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{productType === 'parent' ? 'Base Unit of Measure' : 'Unit of Measure'}</FormLabel>
              <InlineEditableSelect
                items={unitsOfMeasure}
                isLoading={isLoadingUnits}
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
                  return undefined;
                }}
                onRename={async (id, name) => {
                  const existing = unitsOfMeasure.find((u: UnitOfMeasure) => u.id === id);
                  const r = await updateUnitOfMeasure(id, name, existing?.abbreviation ?? name);
                  if (r.success) { await refreshUnits(); return name; }
                  return undefined;
                }}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {itemType === 'standard' && productType === 'child' && (
        <FormField
          control={form.control}
          name="conversionFactor"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Conversion Factor</FormLabel>
              <FormControl>
                <Input type="number" placeholder="e.g., 12" value={field.value} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
              </FormControl>
              <FormDescription>How many base units are in this child unit?</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {/* Stock and Reorder Point are standard-only, leaving Cost alone here for
          a service — kept at two columns so it lines up with every field
          above it. */}
      <div className={`grid grid-cols-1 gap-4 ${itemType === 'standard' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {itemType === 'standard' && (
          <FormField
            control={form.control}
            name="stock"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Initial Stock</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0" value={field.value} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {itemType === 'standard' && (
          <FormField
            control={form.control}
            name="reorderPoint"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reorder Point</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0" value={field.value} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="cost"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between h-6">
                <FormLabel>{itemType === 'service' ? 'Cost (required)' : 'Cost (₱)'}</FormLabel>
              </div>
              <FormControl>
                <Input type="number" step="0.01" placeholder="e.g., 50.00" value={field.value || ''} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );
}
