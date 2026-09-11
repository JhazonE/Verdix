'use client';

import { PlusCircle, Wand2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnitOfMeasure } from '@/lib/types';

import { useEditProductFormContext } from '../edit-product-form-context';

/**
 * Selling Units — the ways this one product can be sold.
 *
 * The base unit is not listed here: it follows the product's own unit of
 * measure, price and cost, and its factor stays 1. Removing a row here deletes
 * that selling unit on save.
 */
export function SellingUnitsTab() {
  const {
    form,
    sellingUnitFields, appendSellingUnit, removeSellingUnit,
    units,
    selectedUnitOfMeasure,
  } = useEditProductFormContext();

  const newUnit = { name: '', factor: 1, barcode: '', cost: undefined, price: 0 };

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-medium leading-none">Selling Units</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Other ways to sell this product (e.g. 1 Case = 60 {selectedUnitOfMeasure || 'base units'}).
            Each can have its own barcode and price. Stock stays a single figure in{' '}
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
        <div className="space-y-3">
          {sellingUnitFields.map((field, index) => (
            <div key={field.id} className="p-3 bg-card border rounded-md shadow-sm">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[150px]">
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

                <div className="w-[130px]">
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

                <div className="w-[160px]">
                  <FormField
                    control={form.control}
                    name={`sellingUnits.${index}.barcode`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Barcode</FormLabel>
                        <FormControl>
                          <Input placeholder="Optional" value={field.value ?? ''} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="w-[110px]">
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
                            min="0"
                            placeholder="Optional"
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

                <div className="w-[110px]">
                  <FormField
                    control={form.control}
                    name={`sellingUnits.${index}.price`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Price</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
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

                <div className="pt-6">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
