'use client';

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';

type Props = {
  form: UseFormReturn<any>;
  userTypes: any[];
  onCreateNew: () => void;
};

export function UserTypeSelectField({ form, userTypes, onCreateNew }: Props) {
  return (
    <FormField
      control={form.control}
      name="userType"
      render={({ field }) => (
        <FormItem>
          <FormLabel>User Type</FormLabel>
          <Select
            onValueChange={value => {
              if (value === 'CREATE_NEW') onCreateNew();
              else field.onChange(value);
            }}
            value={field.value}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select a user type" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {userTypes.map(type => (
                <SelectItem key={type.id} value={type.name}>{type.name}</SelectItem>
              ))}
              <div className="border-t my-1" />
              <SelectItem value="CREATE_NEW" className="text-primary font-medium focus:text-primary">
                <div className="flex items-center">
                  <Plus className="mr-2 h-4 w-4" />
                  Create New User Type...
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
