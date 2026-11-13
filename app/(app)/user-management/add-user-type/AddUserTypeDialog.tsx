'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { ALL_PERMISSIONS } from '../permissions';
import { useAddUserType } from './use-add-user-type';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUserTypeUpdated: () => void;
  editingType?: any;
};

export function AddUserTypeDialog({ open, onOpenChange, onUserTypeUpdated, editingType }: Props) {
  const { form, onSubmit } = useAddUserType({ open, onOpenChange, onUserTypeUpdated, editingType });
  const { isSubmitting } = form.formState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden flex flex-col h-auto max-h-[85vh]">
        <DialogHeader className="p-6 pb-4 bg-muted/30">
          <DialogTitle>{editingType ? 'Edit User Type' : 'Create New User Type'}</DialogTitle>
          <DialogDescription>Define a role and its default permissions.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-6 space-y-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role Name</FormLabel>
                      <FormControl><Input placeholder="e.g. Manager" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl><Textarea placeholder="What is this role for?" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="permissions"
                  render={() => (
                    <FormItem className="space-y-4">
                      <Label className="text-sm font-medium">Permissions</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4 rounded-md border bg-muted/10">
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
                                    onCheckedChange={(checked: boolean) =>
                                      checked
                                        ? field.onChange([...field.value, permission.id])
                                        : field.onChange(field.value.filter((v: string) => v !== permission.id))
                                    }
                                  />
                                </FormControl>
                                <FormLabel className="font-normal cursor-pointer text-sm">{permission.label}</FormLabel>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <DialogFooter className="p-6 pt-4 bg-muted/30 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : editingType ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
