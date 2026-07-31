'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import type { ApiSyncLog } from '@/lib/services/api-sync-logger';
import { EMPTY_FORM, type ExternalApi, type ApiRole, type AllowedMethods } from './external-api-types';

export type ApiForm = Omit<ExternalApi, 'id' | 'createdAt' | 'updatedAt'>;

export function useExternalApi() {
  const { toast } = useToast();

  const [apis, setApis] = useState<ExternalApi[]>([]);
  const [logs, setLogs] = useState<ApiSyncLog[]>([]);
  const [isLoadingApis, setIsLoadingApis] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isClearingLogs, setIsClearingLogs] = useState(false);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [logStatusFilter, setLogStatusFilter] = useState('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApi, setEditingApi] = useState<ExternalApi | null>(null);
  const [form, setForm] = useState<ApiForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExternalApi | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchApis = async () => {
    setIsLoadingApis(true);
    try {
      const res = await fetch(getApiUrl('/settings/external-api'));
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.success) setApis(data.apis);
    } catch { toast({ variant: 'destructive', title: 'Error', description: 'Failed to load APIs.' }); }
    finally { setIsLoadingApis(false); }
  };

  const fetchLogs = async (statusFilter?: string) => {
    setIsLoadingLogs(true);
    try {
      const status = statusFilter ?? logStatusFilter;
      const qs = status !== 'all' ? `?limit=50&status=${status}` : '?limit=50';
      const res = await fetch(getApiUrl(`/external-api/logs${qs}`));
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.success) setLogs(data.logs);
    } catch { toast({ variant: 'destructive', title: 'Error', description: 'Failed to load logs.' }); }
    finally { setIsLoadingLogs(false); }
  };

  const handleStatusFilterChange = (value: string) => { setLogStatusFilter(value); fetchLogs(value); };

  const handleRetryLog = async (log: ApiSyncLog) => {
    if (!log.id) return;
    setRetryingLogId(log.id);
    try {
      const res = await fetch(getApiUrl(`/external-api/logs/${log.id}/retry`), { method: 'POST' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.success) { toast({ title: 'Retry Successful', description: 'The sync operation completed successfully.' }); fetchLogs(); }
      else toast({ variant: 'destructive', title: 'Retry Failed', description: data.error || 'Failed to retry.' });
    } catch { toast({ variant: 'destructive', title: 'Retry Failed', description: 'Network error.' }); }
    finally { setRetryingLogId(null); }
  };

  const clearLogs = async () => {
    setIsClearingLogs(true);
    try {
      const res = await fetch(getApiUrl('/external-api/logs?confirm=CLEAR'), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to clear logs.');
      toast({ title: 'Logs Cleared', description: `Cleared ${data.data.deleted} log entries.` });
      await fetchLogs(logStatusFilter);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Failed to clear logs.' });
    } finally {
      setIsClearingLogs(false);
    }
  };

  const openAddDialog = () => { setEditingApi(null); setForm(EMPTY_FORM); setDialogOpen(true); };

  const openEditDialog = (api: ExternalApi) => {
    setEditingApi(api);
    setForm({
      name: api.name, description: api.description ?? '', enabled: api.enabled,
      apiEndpoint: api.apiEndpoint, authType: api.authType,
      apiKey: api.apiKey ?? '', bearerToken: api.bearerToken ?? '',
      allowedMethods: api.allowedMethods, timeout: api.timeout,
      retryAttempts: api.retryAttempts, retryDelay: api.retryDelay,
      syncMode: api.syncMode, onErrorAction: api.onErrorAction, role: api.role ?? 'general',
      provider: api.provider ?? 'generic',
      loginEmail: api.loginEmail ?? '',
      loginPassword: api.loginPassword ?? '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ variant: 'destructive', title: 'Validation Error', description: 'Name is required.' }); return; }
    if (!form.apiEndpoint.trim()) { toast({ variant: 'destructive', title: 'Validation Error', description: 'API Endpoint is required.' }); return; }
    if (form.provider === 'sta_lucia' && (!form.loginEmail?.trim() || !form.loginPassword?.trim())) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Tenant email and password are required for Sta. Lucia.' });
      return;
    }
    setIsSaving(true);
    try {
      const url = editingApi ? getApiUrl(`/settings/external-api/${editingApi.id}`) : getApiUrl('/settings/external-api');
      const method = editingApi ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (data.success) {
        toast({ title: editingApi ? 'API Updated' : 'API Added', description: `"${form.name}" has been saved.` });
        setDialogOpen(false); fetchApis();
      } else toast({ variant: 'destructive', title: 'Error', description: data.error || 'Failed to save.' });
    } catch { toast({ variant: 'destructive', title: 'Error', description: 'Network error.' }); }
    finally { setIsSaving(false); }
  };

  const handleToggleEnabled = async (api: ExternalApi) => {
    try {
      const res = await fetch(getApiUrl(`/settings/external-api/${api.id}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...api, enabled: !api.enabled }) });
      const data = await res.json();
      if (data.success) setApis(prev => prev.map(a => a.id === api.id ? { ...a, enabled: !a.enabled } : a));
    } catch {}
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(getApiUrl(`/settings/external-api/${deleteTarget.id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.success) {
        toast({ title: 'API Deleted', description: `"${deleteTarget.name}" has been removed.` });
        setApis(prev => prev.filter(a => a.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } catch { toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete API.' }); }
    finally { setIsDeleting(false); }
  };

  const handleTestConnection = async (api: ExternalApi) => {
    setTestingId(api.id);
    try {
      if (api.provider === 'sta_lucia') {
        const res = await fetch(getApiUrl('/integrations/sta-lucia/test'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiId: api.id }),
        });
        const data = await res.json();
        if (data.success) {
          toast({
            title: 'Sta Lucia Connection OK',
            description: `Login, sales submission, and logout all succeeded against ${api.apiEndpoint}.`,
          });
          console.log('Sta Lucia test — payload sent:', data.payload);
          // NOTE: the response is intentionally not logged — it carries the
          // mall's owner_token, and dumping it to the console would leave a
          // live session token sitting in browser console history.
        } else {
          toast({ variant: 'destructive', title: 'Sta Lucia Test Failed', description: data.error });
        }
        return;
      }

      const res = await fetch(getApiUrl(`/settings/external-api/${api.id}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', apiEndpoint: api.apiEndpoint, authType: api.authType, apiKey: api.apiKey, bearerToken: api.bearerToken, timeout: api.timeout, role: api.role }),
      });
      const data = await res.json();
      if (data.success) toast({ title: 'Connection Successful', description: data.message });
      else toast({ variant: 'destructive', title: 'Connection Failed', description: data.error });
    } catch { toast({ variant: 'destructive', title: 'Test Failed', description: 'Network error.' }); }
    finally { setTestingId(null); }
  };

  /**
   * Submit the most recent Z-reading on demand. The server resolves "most
   * recent" itself — the Z-reading GET route takes mode/startDate/endDate/
   * terminalId and has no "latest" parameter, so asking it here would mean
   * fetching the whole history just to read one row.
   */
  const handleSendZReading = async (api: ExternalApi) => {
    setSendingId(api.id);
    try {
      const res = await fetch(getApiUrl('/integrations/sta-lucia/send'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: api.id }),
      });
      const data = await res.json();

      if (data.skipped) {
        toast({ title: 'Already Sent', description: `Z-reading ${data.zReadingId} was submitted previously.` });
      } else if (data.success) {
        toast({ title: 'Sales Submitted', description: `Z-reading ${data.zReadingId} sent to Sta Lucia.` });
      } else {
        toast({ variant: 'destructive', title: 'Submission Failed', description: data.error });
      }
      fetchLogs();
    } catch { toast({ variant: 'destructive', title: 'Submission Failed', description: 'Network error.' }); }
    finally { setSendingId(null); }
  };

  useEffect(() => { fetchApis(); fetchLogs(); }, []);

  return {
    apis, logs, isLoadingApis, isLoadingLogs,
    retryingLogId, logStatusFilter, handleStatusFilterChange, handleRetryLog,
    dialogOpen, setDialogOpen, editingApi, form, setForm, isSaving,
    testingId, sendingId, deleteTarget, setDeleteTarget, isDeleting,
    pendingCount: logs.filter(l => l.status === 'pending').length,
    openAddDialog, openEditDialog,
    handleSave, handleToggleEnabled, handleDelete, handleTestConnection, handleSendZReading,
    fetchLogs, clearLogs, isClearingLogs,
  };
}
