'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Database, HardDrive, RotateCcw, Trash2 } from 'lucide-react';
import type { ResetAction } from './data-management-types';

interface Props {
  onOpenResetDialog: (action: ResetAction) => void;
}

export function ResetDataTab({ onOpenResetDialog }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Danger Zone</CardTitle>
        <CardDescription>Destructive actions to reset system data. These actions cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border border-red-200 rounded-lg p-4 bg-red-50 dark:bg-red-950/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-red-900 dark:text-red-200">Clear Sales Data</h3>
              <p className="text-sm text-red-700 dark:text-red-300">
                Deletes all sales transactions (POS, Orders, Invoices), purchase orders, payments, shifts, readings, and related approval queue items. Invoice numbering restarts at SI 000001.
              </p>
            </div>
            <Button variant="destructive" onClick={() => onOpenResetDialog('clear_sales')}>
              <Trash2 className="mr-2 h-4 w-4" /> Clear Sales
            </Button>
          </div>
        </div>

        <div className="border border-orange-200 rounded-lg p-4 bg-orange-50 dark:bg-orange-950/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-orange-900 dark:text-orange-200">Reset Transaction References</h3>
              <p className="text-sm text-orange-700 dark:text-orange-300">
                Resets all transaction counters and terminal OR numbers to default values.
              </p>
            </div>
            <Button variant="outline" className="border-orange-200 hover:bg-orange-100 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300" onClick={() => onOpenResetDialog('reset_references')}>
              <RotateCcw className="mr-2 h-4 w-4" /> Reset References
            </Button>
          </div>
        </div>

        <div className="border border-red-200 rounded-lg p-4 bg-red-50 dark:bg-red-950/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-red-900 dark:text-red-200">Delete Inventory</h3>
              <p className="text-sm text-red-700 dark:text-red-300">
                Deletes ALL products, stock history, adjustments, transfers, counts, and product shelves.
              </p>
            </div>
            <Button variant="destructive" onClick={() => onOpenResetDialog('clear_inventory')}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete Inventory
            </Button>
          </div>
        </div>

        <div className="border border-orange-200 rounded-lg p-4 bg-orange-50 dark:bg-orange-950/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-orange-900 dark:text-orange-200">Clear Master Data</h3>
              <p className="text-sm text-orange-700 dark:text-orange-300">
                Deletes all Customers, Suppliers, Categories, Brands, Units, and Shelf Locations.
              </p>
            </div>
            <Button variant="outline" className="border-orange-200 hover:bg-orange-100 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300" onClick={() => onOpenResetDialog('clear_master_data')}>
              <Database className="mr-2 h-4 w-4" /> Clear Master Data
            </Button>
          </div>
        </div>

        <div className="border-2 border-destructive rounded-lg p-6 bg-destructive/5">
          <div className="flex items-center justify-between">
            <div className="flex-1 mr-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <h3 className="text-xl font-bold text-destructive">Full Factory Reset</h3>
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                This will wipe ALL data from the system except for existing user accounts and basic system settings.
                The system will be returned to its initial empty state.
              </p>
            </div>
            <Button variant="destructive" size="lg" className="px-8 shadow-lg shadow-destructive/20" onClick={() => onOpenResetDialog('factory_reset')}>
              <HardDrive className="mr-2 h-5 w-5" /> FACTORY RESET
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
