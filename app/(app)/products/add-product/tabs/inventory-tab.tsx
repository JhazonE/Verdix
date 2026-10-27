'use client';

import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
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
    hideInitialStock,
  } = useAddProductFormContext();

  /**
   * The Warehouses chip list is ONE control over TWO form fields: `warehouse`
   * (the primary row, which owns the scannable barcode, because
   * `product_selling_units.barcode` is UNIQUE globally) and
   * `additionalWarehouses` (a sibling `products` row each, with its own
   * opening stock). Keeping that split means the submitted payload — and so
   * every line of the write path — is exactly what it was before this control
   * became a multi-select.
   *
   * Order is therefore load-bearing: the head of the list is the primary.
   */
  const primaryWarehouse = form.watch('warehouse');
  const extraWarehouses = form.watch('additionalWarehouses') ?? [];

  const warehouseSelection = [
    ...(primaryWarehouse ? [primaryWarehouse] : []),
    ...extraWarehouses.map((r: any) => r?.warehouseId).filter(Boolean),
  ] as string[];

  /**
   * Opening stock is typed on the warehouse's own row inside the picker, so
   * the quantity sits with the warehouse it belongs to instead of in a
   * separate block. It still lands in two different form fields: the primary's
   * figure is `stock` (the product row's own column) and each extra's is its
   * `additionalWarehouses` row.
   */
  const stockFor = (id: string): number | undefined => {
    if (id === primaryWarehouse) return form.watch('stock') as number | undefined;
    return extraWarehouses.find((r: any) => r?.warehouseId === id)?.stock;
  };

  const setStockFor = (id: string, raw: string) => {
    // Blank stays undefined rather than becoming 0: the schema defaults it on
    // submit, and this is what lets the field be cleared and retyped.
    const parsed = raw === '' ? undefined : parseInt(raw, 10) || 0;
    if (id === primaryWarehouse) {
      form.setValue('stock', parsed as any, { shouldValidate: true, shouldDirty: true });
      return;
    }
    const index = extraWarehouses.findIndex((r: any) => r?.warehouseId === id);
    if (index < 0) return;
    form.setValue(`additionalWarehouses.${index}.stock`, parsed as any, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const setWarehouseSelection = (ids: string[]) => {
    const [first, ...rest] = ids;
    form.setValue('warehouse', first ?? '', { shouldValidate: true, shouldDirty: true });
    // Each surviving id keeps the row it already had, so an opening quantity
    // already typed is not discarded when another warehouse is ticked.
    form.setValue(
      'additionalWarehouses',
      rest.map(
        (id) =>
          extraWarehouses.find((r: any) => r?.warehouseId === id) ?? { warehouseId: id, stock: 0 },
      ),
      { shouldValidate: true, shouldDirty: true },
    );
  };

  if (itemType === 'service') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="vatStatus"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">VAT Status</FormLabel>
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
                  return { error: r.message };
                }}
                onRename={async (id, name) => {
                  const existing = unitsOfMeasure.find((u: UnitOfMeasure) => u.id === id);
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
              {/* Cost is OPTIONAL on a service (see serviceProductSchema — a
                  pure-margin service with no input cost is a real case), so
                  this carries no required marker. The label used to read
                  "Cost (required)", which the schema never enforced. */}
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
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {itemType === 'standard' && (
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

        {/* Reorder Point is set per supplier mapping on the Suppliers tab
            (rop) — there's no field for it here, so there's exactly one
            place to look.

            Initial Stock has no field of its own either — in EITHER mode: it
            belongs on each warehouse's row inside the Warehouses picker below,
            where the quantity sits with the warehouse it applies to. A
            standalone field here would be a second place showing the SAME
            primary-warehouse figure.

            Purchase Order's inline "Add New Product" used to be the exception
            and rendered a disabled Initial Stock box here, because its picker
            hid the per-row quantities. The picker now keeps those rows in both
            modes (disabled at 0 for a PO), so that box became a duplicate of
            what the rows already say, and the two forms differed for no reason
            a user could see. Where a PO's stock actually comes from is said on
            the Warehouses tooltip instead. */}

        {/* Warehouse and Shelf are stock-only — a service skips both. Unit of
            Measure moved to the Selling Units tab for standard items (it has
            no equivalent for a service, which has no selling units at all).

            In the SAME grid as the fields above rather than a second one of
            its own: a grid that ends on an odd field left Availability alone
            on its row with a hole beside it, and the next grid started a
            fresh row underneath. One grid lets the fields simply flow. */}
        {itemType === 'standard' && (
          <FormField
            control={form.control}
            name="warehouse"
            render={({ field }) => (
              <FormItem>
                {/* A bare FormLabel is a 14px line (leading-none), but the
                    tooltip's icon sits in a button that line-height does not
                    govern, so making the label a flex row grew it and pushed
                    this whole field out of line with the plain-label field
                    beside it. Pinning both to that same 14px puts the two
                    columns back on one baseline. */}
                <FormLabel className="flex h-4 items-center gap-1.5">
                  Warehouses
                  {/* Initial Stock has no field of its own any more, so say
                      where it went — otherwise it reads as simply missing.
                      Shown in both modes: on a PO the question is the same
                      one, only the answer differs. */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="How initial stock is set"
                          className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
                          // A label click would focus the field and open the
                          // popover over the tooltip.
                          onClick={(e) => e.preventDefault()}
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[260px]">
                        {hideInitialStock
                          ? // Same picker, same multi-warehouse meaning — only
                            // the quantity is not entered here, so say where it
                            // comes from instead of dropping the help entirely.
                            'Pick every warehouse this item is stocked in. The first one picked is the primary — it owns the scannable barcode. Stock arrives when this purchase order is received.'
                          : 'Pick every warehouse this item is stocked in, then type its initial stock on each warehouse’s own row. The first one picked is the primary — it owns the scannable barcode.'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </FormLabel>
                {/* One chip multi-select, the same control Shelf Locations
                    uses, rather than a single select plus a separate "also
                    stock in..." block. The FIRST pick stays `warehouse` — the
                    primary row, which owns the scannable barcode — and the
                    rest become `additionalWarehouses`, so the submitted shape
                    and the whole write path are unchanged. */}
                <InlineEditableMultiSelect
                  items={(warehouses || []).filter((w: any) => w.isActive !== false)}
                  value={warehouseSelection}
                  onChange={setWarehouseSelection}
                  placeholder={isLoadingWarehouses ? 'Loading...' : 'Select warehouses...'}
                  searchPlaceholder="Search warehouse..."
                  addLabel="Add Warehouse"
                  emptyLabel="No warehouses found."
                  getId={(w: any) => w.id}
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
                  // The row keeps its quantity slot in BOTH modes so the picker
                  // reads the same here as on the Products module. In PO mode
                  // it is disabled at 0 rather than removed: dropping it made
                  // the control look like a different, simpler one, when the
                  // only real difference is that a PO's stock is entered on the
                  // order itself, not here.
                  renderRowAccessory={(id) => {
                    const warehouseName =
                      (warehouses || []).find((w: any) => w.id === id)?.name ?? 'warehouse';
                    if (hideInitialStock) {
                      return (
                        <Input
                          type="text"
                          value="0"
                          disabled
                          readOnly
                          aria-label={`Initial stock for ${warehouseName} — set when this purchase order is received`}
                          className="h-7 w-20 text-right"
                        />
                      );
                    }
                    return (
                      <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        aria-label={`Initial stock for ${warehouseName}`}
                        className="h-7 w-20 text-right"
                        value={stockFor(id) ?? ''}
                        onChange={(e) => setStockFor(id, e.target.value)}
                      />
                    );
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

      {/* Opening stock per warehouse is typed on each warehouse's own row
          inside the Warehouses picker above, so there is no separate block
          for it here. */}

      {itemType === 'standard' && productType === 'child' && (
        <FormField
          control={form.control}
          name="conversionFactor"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex h-4 items-center">Conversion Factor</FormLabel>
              <FormControl>
                <Input type="number" placeholder="e.g., 12" value={field.value} onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
              </FormControl>
              <FormDescription>How many base units are in this child unit?</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </>
  );
}
