'use client';

import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { ALL_PERMISSIONS } from './permissions';
import { UseFormReturn } from 'react-hook-form';

type Props = {
  form: UseFormReturn<any>;
  disabledForCashier?: boolean;
};

export function UserPermissionsGrid({ form, disabledForCashier }: Props) {
  const watchedUserType = form.watch('userType');
  const isDisabled = disabledForCashier && watchedUserType === 'Cashier';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 p-4 rounded-xl bg-muted/20 border border-muted-foreground/10">
      {ALL_PERMISSIONS.map(permission => (
        <FormField
          key={permission.id}
          control={form.control}
          name="permissions"
          render={({ field }) => (
            <FormItem key={permission.id} className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value?.includes(permission.id)}
                  disabled={isDisabled}
                  onCheckedChange={checked =>
                    checked
                      ? field.onChange([...(field.value || []), permission.id])
                      : field.onChange(field.value?.filter((v: string) => v !== permission.id))
                  }
                />
              </FormControl>
              <FormLabel className="font-normal cursor-pointer">{permission.label}</FormLabel>
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
