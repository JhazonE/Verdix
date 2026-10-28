'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Lock } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AddTaxRateDialog } from './add-tax-rate-dialog';
import { EditTaxRateDialog } from './edit-tax-rate-dialog';
import { AdminAuthDialog } from '../../pos/admin-auth/AdminAuthDialog';
import { TaxRatesTable } from './TaxRatesTable';
import { useTaxRates } from './use-tax-rates';

export default function TaxRatesPage() {
  const {
    taxRates, isLoading, isAuthLoading, isAuthenticated, posSettings,
    showAuthDialog, setShowAuthDialog, setIsAuthenticated,
    selectedTaxRate, taxRateToDelete, setTaxRateToDelete,
    isEditDialogOpen, setIsEditDialogOpen,
    vatRegistration, isSavingVat,
    fetchTaxRates, handleEdit, handleDelete, handleSaveVatRegistration,
  } = useTaxRates();

  if (isAuthLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated && posSettings?.enableTaxRatesAuth) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
        <div className="p-4 rounded-full bg-muted/50">
          <Lock className="h-12 w-12 text-muted-foreground" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Authentication Required</h2>
          <p className="text-muted-foreground">
            Direct access to Tax Rates is protected. Please authenticate to continue.
          </p>
        </div>
        <Button onClick={() => setShowAuthDialog(true)}>Enter Credentials</Button>
        <AdminAuthDialog
          isOpen={showAuthDialog}
          onOpenChange={setShowAuthDialog}
          onSuccess={() => { setIsAuthenticated(true); fetchTaxRates(); }}
          requiredCredentials={{ username: posSettings.taxRatesAuthUsername, password: posSettings.taxRatesAuthPassword }}
          title="Tax Rates Authentication"
          description="Enter valid credentials to manage tax rates."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Tax Rates</h2>
          <p className="text-muted-foreground">Manage tax rates applicable across the system</p>
        </div>
        <AddTaxRateDialog onTaxRateAdded={fetchTaxRates} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>VAT Registration</CardTitle>
          <CardDescription>Determines the TIN label shown on the receipt header</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="vatRegistration">Registration Type</Label>
            <Select
              value={vatRegistration}
              onValueChange={v => handleSaveVatRegistration(v as 'VAT' | 'NON_VAT')}
              disabled={isSavingVat}
            >
              <SelectTrigger id="vatRegistration"><SelectValue placeholder="Select registration type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="VAT">VAT Registered</SelectItem>
                <SelectItem value="NON_VAT">Non-VAT Registered</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Shown on the receipt header (e.g. &quot;VAT REG TIN&quot; or &quot;NON-VAT REG TIN&quot;)
            </p>
          </div>
        </CardContent>
      </Card>

      <TaxRatesTable
        taxRates={taxRates}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDeleteRequest={setTaxRateToDelete}
      />

      {selectedTaxRate && (
        <EditTaxRateDialog
          taxRate={selectedTaxRate}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onTaxRateUpdated={fetchTaxRates}
        />
      )}

      <AlertDialog open={!!taxRateToDelete} onOpenChange={open => !open && setTaxRateToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the tax rate &quot;{taxRateToDelete?.name}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={e => e.stopPropagation()}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.stopPropagation(); handleDelete(); }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

