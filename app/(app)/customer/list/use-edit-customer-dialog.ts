'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { getApiUrl } from '@/lib/api-config';
import { Customer } from '@/lib/types';

interface LoyaltySetting {
  id: string;
  description: string;
  base: string;
  amount: number;
  equivalent: number;
}

const customerSchema = z.object({
  name: z.string().min(1, 'Customer name is required'),
  contactNumber: z.string().min(1, 'Contact number is required'),
  active: z.boolean().default(true),
  loyaltyPoints: z.coerce.number().min(0).default(0),
  paymentTerms: z.string().optional(),
  address: z.string().optional(),
  billingAddress: z.string().optional(),
  discount: z.coerce.number().min(0).max(100, 'Discount must be between 0 and 100'),
  creditLimit: z.coerce.number().min(0, 'Credit limit must be non-negative'),
  priceLevelId: z.string().optional(),
});

export type CustomerFormValues = z.infer<typeof customerSchema>;

interface Options {
  customer: Customer;
  onSave: (values: CustomerFormValues) => Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function useEditCustomerDialog({
  customer,
  onSave,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: Options) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = isControlled ? setControlledOpen || (() => {}) : setInternalOpen;

  const [isSaving, setIsSaving] = useState(false);
  const [priceLevels, setPriceLevels] = useState<any[]>([]);
  const [isLoadingPriceLevels, setIsLoadingPriceLevels] = useState(false);
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySetting[]>([]);
  const [isLoadingLoyaltySettings, setIsLoadingLoyaltySettings] = useState(false);
  const [paymentTermsList, setPaymentTermsList] = useState<any[]>([]);
  const [isLoadingPaymentTerms, setIsLoadingPaymentTerms] = useState(false);
  const [isManagePaymentTermsOpen, setIsManagePaymentTermsOpen] = useState(false);
  const [isPaymentTermsSelectOpen, setIsPaymentTermsSelectOpen] = useState(false);
  const [sameAsAddress, setSameAsAddress] = useState(false);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: customer.name || '',
      contactNumber: customer.contactNumber || '',
      active: customer.active === undefined ? true : !!customer.active,
      loyaltyPoints: customer.loyaltyPoints || 0,
      paymentTerms: customer.paymentTerms || '',
      address: customer.address || '',
      billingAddress: customer.billingAddress || '',
      discount: customer.discount || 0,
      creditLimit: customer.creditLimit || 0,
      priceLevelId: customer.priceLevelId || '',
    },
  });

  useEffect(() => {
    if (isOpen && customer) {
      form.reset({
        name: customer.name || '',
        contactNumber: customer.contactNumber || '',
        active: customer.active === undefined ? true : !!customer.active,
        loyaltyPoints: customer.loyaltyPoints || 0,
        paymentTerms: customer.paymentTerms || '',
        address: customer.address || '',
        billingAddress: customer.billingAddress || '',
        discount: customer.discount || 0,
        creditLimit: customer.creditLimit || 0,
        priceLevelId: customer.priceLevelId || '',
      });
      setSameAsAddress(false);
      fetchPriceLevels();
      fetchLoyaltySettings();
      fetchPaymentTerms();
    }
  }, [isOpen, customer, form]);

  const fetchPriceLevels = async () => {
    try {
      setIsLoadingPriceLevels(true);
      const levels = await import('../../products/actions').then(m => m.getPriceLevels());
      setPriceLevels(levels);
    } catch (error) {
      console.error('Error fetching price levels:', error);
    } finally {
      setIsLoadingPriceLevels(false);
    }
  };

  const fetchLoyaltySettings = async () => {
    try {
      setIsLoadingLoyaltySettings(true);
      const response = await fetch(getApiUrl('/loyalty-settings'));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();

      if (result.success) {
        setLoyaltySettings(result.data);
      } else {
        console.error('Failed to fetch loyalty settings:', result.error);
      }
    } catch (error) {
      console.error('Error fetching loyalty settings:', error);
    } finally {
      setIsLoadingLoyaltySettings(false);
    }
  };

  const fetchPaymentTerms = async () => {
    try {
      setIsLoadingPaymentTerms(true);
      const response = await fetch(getApiUrl('/payment-terms'));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setPaymentTermsList(result.data);
      }
    } catch (error) {
      console.error('Error fetching payment terms:', error);
    } finally {
      setIsLoadingPaymentTerms(false);
    }
  };

  const handleSubmit = async (values: CustomerFormValues) => {
    setIsSaving(true);
    try {
      await onSave(values);
      await logActivity({
        action: 'UPDATE',
        module: 'CUSTOMERS',
        description: `Updated customer: "${values.name}"`,
        referenceId: customer?.id,
      });
      toast({
        title: 'Customer Updated',
        description: `Customer "${values.name}" has been successfully updated.`,
      });
      setIsOpen(false);
      window.location.reload();
    } catch (error) {
      console.error('Failed to update customer', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update customer. Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    form,
    isOpen,
    setIsOpen,
    isSaving,
    priceLevels,
    isLoadingPriceLevels,
    loyaltySettings,
    isLoadingLoyaltySettings,
    paymentTermsList,
    isLoadingPaymentTerms,
    isManagePaymentTermsOpen,
    setIsManagePaymentTermsOpen,
    isPaymentTermsSelectOpen,
    setIsPaymentTermsSelectOpen,
    sameAsAddress,
    setSameAsAddress,
    handleSubmit,
    fetchPaymentTerms,
  };
}
