'use client';

import { FormControl, FormDescription, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';

import { useEditProductFormContext } from '../edit-product-form-context';

export function LoyaltyTab() {
  const { form } = useEditProductFormContext();

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="earnsPoints"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 col-span-2">
            <div className="space-y-0.5">
              <FormLabel className="text-base">
                Earns Loyalty Points
              </FormLabel>
              <FormDescription>
                Disable this if this product should not earn points. (Note: Products in categories with 5% markup are automatically excluded).
              </FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="isPerishable"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <FormLabel>Perishable</FormLabel>
              <FormDescription>
                Track expiration dates when adding stock for this product.
              </FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  );
}
