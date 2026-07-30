'use client';

import { PlusCircle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { CurrencyIcon } from '../currency-icon';
import { useEditProductFormContext } from '../edit-product-form-context';
import { calculatePriceLevelPrice } from '../use-edit-product-form';

export function PriceLevelsTab() {
  const {
    form,
    priceLevels, isLoadingPriceLevels,
    priceLevelFields, appendPriceLevel, removePriceLevel,
  } = useEditProductFormContext();

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-medium leading-none">Price Levels</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Override the base price for specific customer segments.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => appendPriceLevel({ levelId: '', price: 0 })}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Level Price
          </Button>
        </div>

        {priceLevelFields.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center border-2 border-dashed rounded-lg bg-muted/50">
            <CurrencyIcon className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No price level overrides added yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {priceLevelFields.map((field, index) => (
              <div key={field.id} className="flex gap-4 items-end border p-3 rounded-md bg-muted/30">
                <div className="flex-1">
                  <FormField
                    control={form.control}
                    name={`priceLevels.${index}.levelId`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Level</FormLabel>
                        <Select
                          onValueChange={(newLevelId) => {
                            field.onChange(newLevelId);
                            const selectedLevel = priceLevels.find(l => l.id === newLevelId);
                            if (!selectedLevel) return;
                            const newPrice = calculatePriceLevelPrice(
                              newLevelId,
                              selectedLevel.calculationBase || 'retail',
                              priceLevels,
                              form.getValues('price') || 0,
                              form.getValues('cost') || 0
                            );
                            form.setValue(`priceLevels.${index}.price`, parseFloat(newPrice.toFixed(2)));
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select level" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {isLoadingPriceLevels ? (
                              <SelectItem value="loading" disabled>Loading...</SelectItem>
                            ) : (
                              priceLevels?.map(level => (
                                <SelectItem key={level.id} value={level.id}>
                                  {level.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex-1">
                  <FormField
                    control={form.control}
                    name={`priceLevels.${index}.price`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Price (₱)</FormLabel>
                        <div className="flex gap-2 items-center">
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={field.value ?? ''}
                              onChange={(e) => {
                                const newVal = parseFloat(e.target.value) || 0;
                                field.onChange(newVal);

                                // Sync with main price if this is the default level
                                // We need to check if the FULL level object corresponds to a default level
                                const currentLevelId = form.getValues(`priceLevels.${index}.levelId`);
                                const levelDef = priceLevels.find(l => l.id === currentLevelId);

                                // If it's the default level OR if there's only one level text and it matches
                                if (levelDef?.isDefault || priceLevels.length === 1) {
                                    form.setValue('price', newVal);
                                }
                              }}
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="w-[100px]">
                  <FormField
                    control={form.control}
                    name={`priceLevels.${index}.minQuantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-nowrap">Min Qty</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="0"
                            value={field.value || ''}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive h-10 w-10 hover:text-destructive hover:bg-destructive/10"
                  onClick={() => removePriceLevel(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
