'use client';

import { useState } from 'react';
import { ChevronDown, PlusCircle, Wand2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnitOfMeasure } from '@/lib/types';

import { useEditProductFormContext } from '../edit-product-form-context';
import { InlineEditableSelect } from '../../components/inline-editable-select';
import { addUnitOfMeasure, updateUnitOfMeasure } from '../../actions';

/**
 * One line per system price level, for one selling unit's row. A blank price
 * input means no override for that unit/level — it is never coerced to 0 or
 * to the unit's own price, so the write side (actions.ts) knows to skip it.
 *
 * Two binding modes:
 * - Base unit: binds into the top-level `priceLevels` field array (the same
 *   one the old standalone Price Levels tab used), via the field-array
 *   helpers already returned by the form hook.
 * - Extra unit: binds into `sellingUnits.${unitIndex}.priceLevels`, a plain
 *   nested array kept in sync by hand (find the entry for this level, or
 *   splice one in the moment the user types a value).
 */
function PriceLevelOverrides({
  values,
  onChange,
  requireDefaultLevel = false,
}: {
  values: { levelId: string; price?: number; minQuantity?: number }[];
  onChange: (next: { levelId: string; price?: number; minQuantity?: number }[]) => void;
  /**
   * The base unit has no standalone price any more — its default (Retail)
   * price-level row IS the product's price, so that one row can never be
   * blanked to "no override" the way every other row (and every extra
   * unit's own rows) still can.
   */
  requireDefaultLevel?: boolean;
}) {
  const { priceLevels, isLoadingPriceLevels } = useEditProductFormContext();

  if (isLoadingPriceLevels) {
    return <p className="text-xs text-muted-foreground px-1 py-2">Loading price levels...</p>;
  }
  if (!priceLevels || priceLevels.length === 0) {
    return <p className="text-xs text-muted-foreground px-1 py-2">No price levels configured.</p>;
  }

  const defaultLevelId = requireDefaultLevel
    ? (priceLevels.find((l: any) => l.isDefault) || priceLevels[0])?.id
    : undefined;

  const setPrice = (levelId: string, raw: string) => {
    const next = [...values];
    const idx = next.findIndex(v => v.levelId === levelId);
    if (raw === '') {
      // Blank means "no override" — remove the row entirely rather than
      // writing an empty/0 value. The required default level is the one
      // exception: it can't disappear, since it IS the product's price.
      if (levelId === defaultLevelId) {
        if (idx !== -1) next[idx] = { ...next[idx], price: undefined };
        onChange(next);
        return;
      }
      if (idx !== -1) next.splice(idx, 1);
      onChange(next);
      return;
    }
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return;
    if (idx === -1) {
      next.push({ levelId, price: parsed });
    } else {
      next[idx] = { ...next[idx], price: parsed };
    }
    onChange(next);
  };

  const setMinQuantity = (levelId: string, raw: string) => {
    const next = [...values];
    const idx = next.findIndex(v => v.levelId === levelId);
    const parsed = raw === '' ? undefined : parseInt(raw, 10);
    if (idx === -1) {
      // No price yet — a min-quantity with no override price is meaningless,
      // so there is nothing to store until a price is entered.
      return;
    }
    next[idx] = { ...next[idx], minQuantity: Number.isNaN(parsed as number) ? undefined : parsed };
    onChange(next);
  };

  return (
    <div className="space-y-2 pt-2">
      {priceLevels.map((level: any) => {
        const entry = values.find(v => v.levelId === level.id);
        const isRequired = level.id === defaultLevelId;
        return (
          <div key={level.id} className="flex gap-3 items-end">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">
                {level.name}
                {isRequired && <span className="text-destructive"> *</span>}
              </Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={isRequired ? 'Required' : 'No override'}
                value={entry?.price ?? ''}
                onChange={(e) => setPrice(level.id, e.target.value)}
              />
            </div>
            <div className="w-[100px]">
              <Label className="text-xs text-nowrap text-muted-foreground">Min Qty</Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={entry?.minQuantity ?? ''}
                onChange={(e) => setMinQuantity(level.id, e.target.value)}
                disabled={!entry}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Selling Units — the ways this one product can be sold.
 *
 * The base unit is now shown as a permanent, non-removable first row: its
 * factor is locked to 1, and it posts through the product's own top-level
 * price/cost/barcode fields rather than a `sellingUnits[]` entry. Removing an
 * extra row here deletes that selling unit on save.
 */
export function SellingUnitsTab() {
  const {
    form,
    sellingUnitFields, appendSellingUnit, removeSellingUnit,
    replacePriceLevels,
    units, refreshUnits,
    selectedUnitOfMeasure,
    generateBarcode,
    costSuggestionSource,
  } = useEditProductFormContext();

  const [baseExpanded, setBaseExpanded] = useState(false);
  const [expandedUnits, setExpandedUnits] = useState<Record<number, boolean>>({});
  const [uomSelectOpen, setUomSelectOpen] = useState(false);

  // `cost` is required by the schema now (a genuine number, not optional) —
  // a freshly-appended row still starts without one, same as it always has,
  // so it renders blank via the input's `field.value ?? ''` until the user
  // types something. The `as any` below is that one field's real, expected
  // "not filled in yet" state, not a type-safety workaround for anything
  // else in this object.
  const newUnit = { name: '', factor: 1, barcode: '', cost: undefined, price: 0, priceLevels: [] } as any;

  // The base row's price levels reuse the top-level `priceLevels` field array
  // (same one the old standalone Price Levels tab bound to), keyed by levelId
  // rather than by array index so "blank = no row" holds here too.
  const allPriceLevelValues = form.watch('priceLevels') || [];
  const basePriceLevelValues: { levelId: string; price?: number; minQuantity?: number }[] =
    allPriceLevelValues.filter((v) => !!v?.levelId) as { levelId: string; price?: number; minQuantity?: number }[];

  const setBasePriceLevels = (next: { levelId: string; price?: number; minQuantity?: number }[]) => {
    // One atomic swap via useFieldArray's own replace(), not a remove-loop
    // followed by an append-loop — that used to fire on every keystroke (a
    // new onChange each time the user typed a digit) and momentarily left
    // the field array empty between the removes and the appends, which
    // dropped focus from the input the user was actively typing into.
    replacePriceLevels(next.map(entry => ({ levelId: entry.levelId, price: entry.price ?? 0, minQuantity: entry.minQuantity })));
  };

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-medium leading-none">Selling Units</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Other ways to sell this product (e.g. 1 Case = 60 {selectedUnitOfMeasure || 'base units'}).
            Each can have its own barcode, price, and price-level overrides. Stock stays a single figure in{' '}
            {selectedUnitOfMeasure || 'the base unit'}.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => appendSellingUnit(newUnit)}
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Unit
        </Button>
      </div>

      <div className="space-y-3">
        {/* Base unit row — always present, never removable. */}
        <Collapsible open={baseExpanded} onOpenChange={setBaseExpanded}>
          <div className="bg-card border rounded-md shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Base Unit</span>
                <Badge variant="secondary">Base</Badge>
              </div>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronDown className={`h-4 w-4 transition-transform ${baseExpanded ? 'rotate-180' : ''}`} />
                  <span className="sr-only">Toggle price levels</span>
                </Button>
              </CollapsibleTrigger>
            </div>

            <div className="p-3 grid grid-cols-2 gap-3">
              <div>
                <FormField
                  control={form.control}
                  name="unitOfMeasure"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Unit of Measure</FormLabel>
                      <InlineEditableSelect
                        items={units}
                        isLoading={false}
                        value={field.value}
                        onChange={field.onChange}
                        open={uomSelectOpen}
                        onOpenChange={setUomSelectOpen}
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
              </div>

              <div className="space-y-2">
                <Label className="text-xs">
                  Qty in {selectedUnitOfMeasure || 'base units'}
                </Label>
                <Input type="number" value={1} disabled className="bg-muted/50 text-foreground disabled:opacity-100" />
              </div>

              <div>
                <FormField
                  control={form.control}
                  name="barcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Barcode</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            placeholder="Optional"
                            value={field.value ?? ''}
                            onChange={field.onChange}
                            className="pr-9"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.preventDefault();
                            }}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                          onClick={() => generateBarcode()}
                        >
                          <Wand2 className="h-4 w-4" />
                          <span className="sr-only">Generate Barcode</span>
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div>
                <FormField
                  control={form.control}
                  name="cost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Cost</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          placeholder="Required"
                          value={field.value ?? ''}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            field.onChange(Number.isNaN(parsed) ? undefined : parsed);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                      {costSuggestionSource && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Wand2 className="h-3 w-3" />
                          {costSuggestionSource}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              </div>


            </div>
            <CollapsibleContent>
              <div className="border-t px-3 pb-3 pt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Price Levels</p>
                <PriceLevelOverrides
                  values={basePriceLevelValues}
                  onChange={setBasePriceLevels}
                  requireDefaultLevel
                />
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {sellingUnitFields.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center border-2 border-dashed rounded-lg bg-muted/50">
            <Wand2 className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No extra selling units. This product sells by {selectedUnitOfMeasure || 'its base unit'} only.
            </p>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => appendSellingUnit(newUnit)}
              className="mt-1"
            >
              Add your first selling unit
            </Button>
          </div>
        ) : (
          sellingUnitFields.map((field, index) => {
            const expanded = !!expandedUnits[index];
            const unitPriceLevels = form.watch(`sellingUnits.${index}.priceLevels`) || [];
            return (
              <Collapsible
                key={field.id}
                open={expanded}
                onOpenChange={(open) => setExpandedUnits(prev => ({ ...prev, [index]: open }))}
              >
                <div className="bg-card border rounded-md shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b">
                    <span className="text-sm font-medium">
                      {form.watch(`sellingUnits.${index}.name`) || 'Selling Unit'}
                    </span>
                    <div className="flex items-center gap-1">
                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
                          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                          <span className="sr-only">Toggle price levels</span>
                        </Button>
                      </CollapsibleTrigger>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                        onClick={() => removeSellingUnit(index)}
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 grid grid-cols-2 gap-3">
                    <div>
                      <FormField
                        control={form.control}
                        name={`sellingUnits.${index}.name`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Unit Name</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select unit" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {(() => {
                                  const items = [];
                                  const currentVal = field.value;

                                  // Keep a unit that is no longer in Settings selectable,
                                  // so opening the dialog cannot silently blank it.
                                  if (currentVal && !units?.some(u => u.name === currentVal)) {
                                    items.push(
                                      <SelectItem key={`orphan-${currentVal}`} value={currentVal}>
                                        {currentVal} (Missing in Settings)
                                      </SelectItem>
                                    );
                                  }

                                  if (units?.length > 0) {
                                    units.forEach((uom: UnitOfMeasure) => {
                                      if (uom.name !== selectedUnitOfMeasure) {
                                        items.push(
                                          <SelectItem key={uom.id} value={uom.name}>
                                            {uom.name} ({uom.abbreviation})
                                          </SelectItem>
                                        );
                                      }
                                    });
                                  }

                                  return items.length > 0 ? items : (
                                    <SelectItem value="none" disabled>No units available</SelectItem>
                                  );
                                })()}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div>
                      <FormField
                        control={form.control}
                        name={`sellingUnits.${index}.factor`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">
                              Qty in {selectedUnitOfMeasure || 'base units'}
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Qty"
                                value={field.value ?? ''}
                                onChange={(e) => {
                                  const parsed = parseFloat(e.target.value);
                                  field.onChange(Number.isNaN(parsed) ? undefined : parsed);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div>
                      <FormField
                        control={form.control}
                        name={`sellingUnits.${index}.barcode`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Barcode</FormLabel>
                            <div className="relative">
                              <FormControl>
                                <Input
                                  placeholder="Optional"
                                  value={field.value ?? ''}
                                  onChange={field.onChange}
                                  className="pr-9"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.preventDefault();
                                  }}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                                onClick={() => generateBarcode(`sellingUnits.${index}.barcode`)}
                              >
                                <Wand2 className="h-4 w-4" />
                                <span className="sr-only">Generate Barcode</span>
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div>
                      <FormField
                        control={form.control}
                        name={`sellingUnits.${index}.cost`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Cost</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                placeholder="Required"
                                value={field.value ?? ''}
                                onChange={(e) => {
                                  const parsed = parseFloat(e.target.value);
                                  field.onChange(Number.isNaN(parsed) ? undefined : parsed);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                  </div>
                  <CollapsibleContent>
                    <div className="border-t px-3 pb-3 pt-2">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Price Levels</p>
                      <PriceLevelOverrides
                        values={unitPriceLevels}
                        onChange={(next) => form.setValue(`sellingUnits.${index}.priceLevels`, next, { shouldDirty: true })}
                        requireDefaultLevel
                      />
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })
        )}
      </div>
    </div>
  );
}
