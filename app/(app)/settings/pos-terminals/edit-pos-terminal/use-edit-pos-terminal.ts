'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { terminalSchema, type TerminalFormValues, type PosTerminal } from './edit-pos-terminal-types';

function toFormValues(t: PosTerminal): TerminalFormValues {
  return {
    ipAddress:            t.ipAddress            || '',
    terminalDescription:  t.terminalDescription  || '',
    serialNumber:         t.serialNumber         || '',
    min:                  t.min                  || '',
    permitNo:             t.permitNo             || '',
    accreditationNo:      t.accreditationNo      || '',
    permitDateIssued:     t.permitDateIssued ? String(t.permitDateIssued).split('T')[0] : '',
    printOfficialReceipt: t.printOfficialReceipt || 'No',
    orNextReference:      t.orNextReference      || '',
    inventoryLocation:    t.inventoryLocation    || 'Store',
  };
}

export function useEditPosTerminal(terminal: PosTerminal, isOpen: boolean, onTerminalUpdated: () => void) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);

  const form = useForm<TerminalFormValues>({
    resolver: zodResolver(terminalSchema),
    defaultValues: toFormValues(terminal),
  });

  useEffect(() => { form.reset(toFormValues(terminal)); }, [terminal]);

  const fetchWarehouses = async () => {
    try {
      const res = await fetch(getApiUrl('/warehouses?activeOnly=true'));
      if (!res.ok) throw new Error();
      const result = await res.json();
      if (result.success) setWarehouses(result.data);
    } catch (e) { console.error('Error fetching warehouses:', e); }
  };

  useEffect(() => { if (isOpen) fetchWarehouses(); }, [isOpen]);

  const onSubmit = async (values: TerminalFormValues) => {
    setIsSaving(true);
    try {
      const res = await fetch(getApiUrl('/pos-terminals'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: terminal.id, ...values }),
      });
      const result = await res.json();
      if (result.success) {
        toast({ title: 'Terminal Updated', description: 'Terminal has been successfully updated.' });
        onTerminalUpdated();
        return true;
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.error || 'Failed to update terminal.' });
        return false;
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update terminal. Please try again.' });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return { form, isSaving, warehouses, onSubmit };
}
