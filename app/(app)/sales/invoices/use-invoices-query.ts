'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSalesInvoices } from '@/hooks/use-api';
import { getApiUrl } from '@/lib/api-config';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';

interface PosSettings {
  businessName: string;
  address?: string;
  contactNumber?: string;
  logoPath?: string;
}

type QueryParams = {
  setVoidDialogOpen: (id: string | null) => void;
};

export function useInvoicesQuery({ setVoidDialogOpen }: QueryParams) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { salesInvoices, loading, error } = useSalesInvoices();

  const { data: posSettingsData } = useQuery({
    queryKey: ['posSettings'],
    queryFn: async () => {
      const res = await fetch(getApiUrl('/pos-settings'));
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const settings: PosSettings | null = posSettingsData?.success ? posSettingsData.data : null;

  const voidMutation = useMutation({
    mutationFn: async (saleId: string) => {
      const raw = localStorage.getItem('mock-user-session');
      const uid = raw ? JSON.parse(raw).uid : undefined;
      const res = await fetch(getApiUrl(`/sales/invoices/${saleId}/void`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      return res.json();
    },
    onSuccess: async (result, saleId) => {
      if (result.success) {
        await logActivity({ action: 'VOID', module: 'SALES', description: 'Voided sales invoice', referenceId: saleId });
        toast({ title: 'Invoice voided successfully' });
        queryClient.invalidateQueries({ queryKey: ['salesInvoices'] });
      } else {
        toast({ variant: 'destructive', title: 'Failed to void invoice', description: result.error || 'An error occurred' });
      }
      setVoidDialogOpen(null);
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'An error occurred while voiding the invoice' });
      setVoidDialogOpen(null);
    },
  });

  const invalidateInvoices = () => queryClient.invalidateQueries({ queryKey: ['salesInvoices'] });

  return { salesInvoices, loading, error, settings, voidMutation, invalidateInvoices };
}

export type { PosSettings };
