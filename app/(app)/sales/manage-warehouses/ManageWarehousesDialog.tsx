'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useManageWarehouses } from './use-manage-warehouses';
import { WarehouseDialog, WarehouseRow, WarehouseSkeleton } from './WarehouseRow';

interface ManageWarehousesDialogProps {
  trigger?: React.ReactNode;
  onChange?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ManageWarehousesDialog({ trigger, onChange, open, onOpenChange }: ManageWarehousesDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? onOpenChange || (() => {}) : setInternalOpen;

  const m = useManageWarehouses(isOpen, onChange);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Manage Warehouses</DialogTitle>
          <DialogDescription>Add, edit, or delete your warehouses.</DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <div className="flex justify-end mb-4">
            <WarehouseDialog onSave={m.handleAddWarehouse}>
              <Button size="sm">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Warehouse
              </Button>
            </WarehouseDialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.isLoading && Array.from({ length: 4 }).map((_, i) => <WarehouseSkeleton key={i} />)}
                  {m.warehouses?.map((warehouse) => (
                    <WarehouseRow
                      key={warehouse.id}
                      warehouse={warehouse}
                      onUpdate={m.handleUpdate}
                      onDelete={m.handleDelete}
                    />
                  ))}
                  {!m.isLoading && m.warehouses?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center h-24">No warehouses found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <DialogTrigger asChild>
            <Button variant="outline">Close</Button>
          </DialogTrigger>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
