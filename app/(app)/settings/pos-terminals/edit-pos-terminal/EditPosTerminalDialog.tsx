'use client';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useEditPosTerminal } from './use-edit-pos-terminal';
import { TEXT_FIELDS, type PosTerminal } from './edit-pos-terminal-types';

interface Props {
  terminal: PosTerminal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTerminalUpdated: () => void;
}

export function EditPosTerminalDialog({ terminal, open, onOpenChange, onTerminalUpdated }: Props) {
  const { form, isSaving, warehouses, onSubmit } = useEditPosTerminal(terminal, open, onTerminalUpdated);

  const handleSubmit = form.handleSubmit(async (values) => {
    const ok = await onSubmit(values);
    if (ok) onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Pos Terminal</DialogTitle>
          <DialogDescription className="sr-only">Update the configuration for this POS terminal</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-4">

              {TEXT_FIELDS.map(({ name, label }) => (
                <FormField key={name} control={form.control} name={name} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}

              <FormField control={form.control} name="permitDateIssued" render={({ field }) => (
                <FormItem>
                  <FormLabel>PTU DATE ISSUED</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="printOfficialReceipt" render={({ field }) => (
                <FormItem>
                  <FormLabel>Print Official Receipt</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select option" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="No">No</SelectItem>
                      <SelectItem value="Yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="inventoryLocation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Inventory Location</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {warehouses.length === 0
                        ? <SelectItem value="Store">Store</SelectItem>
                        : warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)
                      }
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</> : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
