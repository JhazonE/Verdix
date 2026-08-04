'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useManagePosTerminals } from './use-manage-pos-terminals';

export function ManagePosTerminalsDialog() {
  const [open, setOpen] = useState(false);
  const { form, isSaving, warehouses, onSubmit } = useManagePosTerminals(open);

  const handleSubmit = form.handleSubmit(async (values) => {
    const ok = await onSubmit(values);
    if (ok) setOpen(false);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-primary hover:text-primary/80">
          <span className="text-xs font-medium">Manage</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New POS Terminal</DialogTitle>
          <DialogDescription className="sr-only">Configure and add a new POS terminal</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-4">

              {[
                { name: 'ipAddress',           label: 'IP Address' },
                { name: 'terminalDescription', label: 'Terminal Description' },
                { name: 'serialNumber',        label: 'Serial Number' },
                { name: 'min',                 label: 'MIN' },
                { name: 'permitNo',            label: 'Permit No.' },
                { name: 'accreditationNo',     label: 'Accreditation No.' },
                { name: 'orNextReference',     label: 'OR Next Reference' },
              ].map(({ name, label }) => (
                <FormField key={name} control={form.control} name={name as any} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}

              <FormField control={form.control} name="permitDateIssued" render={({ field }) => (
                <FormItem>
                  <FormLabel>PTU Date Issued</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="printOfficialReceipt" render={({ field }) => (
                <FormItem>
                  <FormLabel>Print Official Receipt</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {warehouses.length === 0 ? (
                        <SelectItem value="Store">Store (Default)</SelectItem>
                      ) : warehouses.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</> : 'Save'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
