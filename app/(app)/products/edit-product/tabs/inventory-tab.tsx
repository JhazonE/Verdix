'use client';

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatQuantity } from '@/lib/utils';
import { UnitOfMeasure } from '@/lib/types';
import type { Supplier } from '@/lib/types';

import { useEditProductFormContext } from '../edit-product-form-context';
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
    refreshWarehouses,
    refreshShelfLocations,
    refreshUnits,
    primarySupplierMapping,
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
              <FormLabel>VAT Status</FormLabel>
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

        <FormField
          control={form.control}
          name="unitOfMeasure"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Base Unit of Measure</FormLabel>
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
              <FormLabel>Cost (required)</FormLabel>
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
              <FormLabel>VAT Status</FormLabel>
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

      </div>

      {/* Warehouse and Shelf are stock-only — a service skips both. Unit of
          Measure moved to the Selling Units tab for standard items (it has
          no equivalent for a service, which has no selling units at all).
          Mirrors the Add form. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!isServiceProduct && (
        <FormField
          control={form.control}
          name="warehouse"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Warehouse (Optional)</FormLabel>
              <InlineEditableSelect
                items={warehouses}
                isLoading={false}
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
                  return { error: r.message };
                }}
                onRename={async (id, name) => {
                  const existing = warehouses.find((w: any) => w.id === id);
                  const r = await updateWarehouse(id, name, existing?.location);
                  if (r.success) { await refreshWarehouses(); return id; }
                  return { error: r.message };
                }}
              />
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

      {/* Stock and Reorder Point are standard-only, leaving Cost alone here for
          a service — kept at two columns so it lines up with every field
          above it. Cost moved to the Selling Units tab's base row — this
          point is standard-item-only, so Stock and Reorder Point get the
          full row now. Mirrors the Add form. */}
      {/* Once a product has a primary supplier mapping, its ROP lives
          entirely on the Suppliers tab — no read-only echo here any more,
          so there's exactly one place to look for it, not two. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className={primarySupplierMapping ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
          <Label>Initial Stock</Label>
          <div>
            <Input type="text" value={formatQuantity(product.stock || 0)} disabled />
          </div>
          <p className="text-sm text-muted-foreground">Stock is updated via transactions.</p>
        </div>
        {!primarySupplierMapping && (
          <FormField
            control={form.control}
            name="reorderPoint"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reorder Point</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0" value={field.value != null ? formatQuantity(field.value) : ''} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>
    </div>
  );
}
