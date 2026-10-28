'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { TaxRate } from '@/lib/types';

export function useTaxRates() {
  const { toast } = useToast();
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [posSettings, setPosSettings] = useState<any>(null);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [selectedTaxRate, setSelectedTaxRate] = useState<TaxRate | null>(null);
  const [taxRateToDelete, setTaxRateToDelete] = useState<TaxRate | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [vatRegistration, setVatRegistration] = useState<'VAT' | 'NON_VAT'>('VAT');
  const [isSavingVat, setIsSavingVat] = useState(false);

  const fetchTaxRates = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl('/settings/tax-rates'));
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (Array.isArray(data)) setTaxRates(data);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load tax rates' });
    } finally {
      setIsLoading(false);
    }
  };

  const checkAuthAndFetch = async () => {
    setIsAuthLoading(true);
    try {
      const res = await fetch(getApiUrl('/pos-settings'));
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result.success) {
        const s = result.data;
        setPosSettings(s);
        setVatRegistration(s.vatRegistration || 'VAT');
        if (s.enableTaxRatesAuth) {
          setShowAuthDialog(true);
        } else {
          setIsAuthenticated(true);
          fetchTaxRates();
        }
      } else {
        setIsAuthenticated(true);
        fetchTaxRates();
      }
    } catch {
      setIsAuthenticated(true);
      fetchTaxRates();
    } finally {
      setIsAuthLoading(false);
    }
  };

  useEffect(() => { checkAuthAndFetch(); }, []);

  const handleEdit = (taxRate: TaxRate) => {
    setSelectedTaxRate(taxRate);
    setIsEditDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!taxRateToDelete) return;
    try {
      const res = await fetch(getApiUrl(`/settings/tax-rates/${taxRateToDelete.id}`), { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        toast({ title: 'Deleted', description: 'Tax rate has been successfully deleted.' });
        fetchTaxRates();
      } else {
        throw new Error(result.error || 'Failed to delete tax rate');
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Failed to delete tax rate' });
    } finally {
      setTaxRateToDelete(null);
    }
  };

  const handleSaveVatRegistration = async (value: 'VAT' | 'NON_VAT') => {
    const previous = vatRegistration;
    setVatRegistration(value);
    setIsSavingVat(true);
    try {
      const res = await fetch(getApiUrl('/pos-settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vatRegistration: value }),
      });
      const result = await res.json();
      if (result.success) {
        setPosSettings((prev: any) => prev ? { ...prev, vatRegistration: value } : prev);
        localStorage.setItem('pos_settings_version', Date.now().toString());
        toast({ title: 'Saved', description: 'VAT registration has been updated.' });
      } else {
        throw new Error(result.error);
      }
    } catch (e) {
      setVatRegistration(previous);
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Failed to update VAT registration' });
    } finally {
      setIsSavingVat(false);
    }
  };

  return {
    taxRates, isLoading, isAuthLoading, isAuthenticated, posSettings,
    showAuthDialog, setShowAuthDialog, setIsAuthenticated,
    selectedTaxRate, taxRateToDelete, setTaxRateToDelete,
    isEditDialogOpen, setIsEditDialogOpen,
    vatRegistration, isSavingVat,
    fetchTaxRates, handleEdit, handleDelete, handleSaveVatRegistration,
  };
}
