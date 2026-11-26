'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import type { BackupFile, BackupSchedule, ResetAction } from './data-management-types';

type CsvKey = 'products' | 'customers' | 'suppliers';
type CsvState = { exporting: boolean; importing: boolean; file: File | null };

const CSV_CONFIG: Record<CsvKey, { exportPath: string; importPath: string; filename: string; label: string }> = {
  products:  { exportPath: '/data-management/export/products',  importPath: '/data-management/import/products',  filename: 'products.csv',  label: 'product' },
  customers: { exportPath: '/data-management/export/customers', importPath: '/data-management/import/customers', filename: 'customers.csv', label: 'customer' },
  suppliers: { exportPath: '/data-management/export/suppliers', importPath: '/data-management/import/suppliers', filename: 'suppliers.csv', label: 'supplier' },
};

const INIT_CSV: Record<CsvKey, CsvState> = {
  products:  { exporting: false, importing: false, file: null },
  customers: { exporting: false, importing: false, file: null },
  suppliers: { exporting: false, importing: false, file: null },
};

export function useDataManagement() {
  const { toast } = useToast();

  // ── Database ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'none' | 'success' | 'error'>('none');
  const [statusMessage, setStatusMessage] = useState('');
  const [dbConfig, setDbConfig] = useState({ host: 'localhost', port: '3306', user: 'root', password: '', database: 'verdix' });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDbConfig(prev => ({ ...prev, [name]: value }));
    if (connectionStatus !== 'none') { setConnectionStatus('none'); setStatusMessage(''); }
  };

  const testConnection = async () => {
    setIsTesting(true); setConnectionStatus('none'); setStatusMessage('');
    try {
      const res = await fetch(getApiUrl('/settings/database'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...dbConfig, action: 'test' }) });
      const data = await res.json();
      if (res.ok) { setConnectionStatus('success'); setStatusMessage(data.message); toast({ title: 'Connection Successful', description: 'Successfully connected to the database.' }); }
      else { setConnectionStatus('error'); setStatusMessage(data.message); toast({ title: 'Connection Failed', description: data.message, variant: 'destructive' }); }
    } catch { setConnectionStatus('error'); setStatusMessage('Network error occurred'); }
    finally { setIsTesting(false); }
  };

  const saveConfiguration = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl('/settings/database'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...dbConfig, action: 'save' }) });
      const data = await res.json();
      if (res.ok) toast({ title: 'Settings Saved', description: data.message });
      else toast({ title: 'Error Saving', description: data.message, variant: 'destructive' });
    } catch { toast({ title: 'Error', description: 'Failed to save settings', variant: 'destructive' }); }
    finally { setLoading(false); }
  };

  // ── Backup & Restore ──────────────────────────────────────────────────────
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [backupToRestore, setBackupToRestore] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [schedule, setSchedule] = useState<BackupSchedule>({ enabled: false, frequency: 'daily', time: '23:00', dayOfWeek: 0 });
  const [savingSchedule, setSavingSchedule] = useState(false);

  const fetchBackups = async () => {
    try { const res = await fetch(getApiUrl('/settings/backup/files')); if (res.ok) setBackups(await res.json()); }
    catch (e) { console.error('Failed to load backups', e); }
  };

  const fetchSchedule = async () => {
    try { const res = await fetch(getApiUrl('/settings/backup/schedule')); if (res.ok) setSchedule(await res.json()); }
    catch (e) { console.error('Failed to load schedule', e); }
  };

  const createBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await fetch(getApiUrl('/settings/backup/manual'), { method: 'POST' });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      toast({ title: 'Backup Created', description: 'Database backup created successfully.' });
      fetchBackups();
    } catch (e: any) { toast({ title: 'Backup Failed', description: e.message || 'Failed to create backup', variant: 'destructive' }); }
    finally { setCreatingBackup(false); }
  };

  const saveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const res = await fetch(getApiUrl('/settings/backup/schedule'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(schedule) });
      if (res.ok) toast({ title: 'Schedule Saved', description: 'Backup schedule updated successfully.' });
      else toast({ title: 'Error', description: 'Failed to save schedule', variant: 'destructive' });
    } catch { toast({ title: 'Error', description: 'Network error', variant: 'destructive' }); }
    finally { setSavingSchedule(false); }
  };

  const downloadBackup = (filename: string) => { window.location.href = getApiUrl(`/settings/backup/download/${filename}`); };
  const openRestoreDialog = (filename: string) => { setBackupToRestore(filename); setRestoreConfirmText(''); setRestoreDialogOpen(true); };

  const handleRestore = async () => {
    if (!backupToRestore) return;
    setRestoringBackup(true);
    try {
      const res = await fetch(getApiUrl('/settings/backup/restore'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: backupToRestore }) });
      const data = await res.json();
      if (res.ok) toast({ title: 'Restore Successful', description: data.message });
      else throw new Error(data.error);
    } catch (e: any) { toast({ title: 'Restore Failed', description: e.message || 'Failed to restore database', variant: 'destructive' }); }
    finally { setRestoringBackup(false); setRestoreDialogOpen(false); setBackupToRestore(null); setRestoreConfirmText(''); }
  };

  // ── Import / Export ───────────────────────────────────────────────────────
  const [csv, setCsv] = useState<Record<CsvKey, CsvState>>(INIT_CSV);
  const setCsvField = (key: CsvKey, field: keyof CsvState, value: any) =>
    setCsv(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const downloadCsv = async (exportPath: string, filename: string, setExp: (v: boolean) => void, label: string) => {
    setExp(true);
    try {
      const res = await fetch(getApiUrl(exportPath));
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to export'); }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      window.URL.revokeObjectURL(url); document.body.removeChild(a);
      toast({ title: 'Export Successful', description: `Your ${label} list has been downloaded.` });
    } catch (e: any) { toast({ title: 'Export Failed', description: e.message, variant: 'destructive' }); }
    finally { setExp(false); }
  };

  const uploadCsv = async (importPath: string, file: File, setImp: (v: boolean) => void, clearFile: () => void) => {
    setImp(true);
    const formData = new FormData(); formData.append('file', file);
    try {
      const res = await fetch(getApiUrl(importPath), { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) { toast({ title: 'Import Successful', description: data.message }); clearFile(); }
      else toast({ title: 'Import Failed', description: data.error || 'Unknown error occurred', variant: 'destructive' });
    } catch { toast({ title: 'Error', description: 'Network error during upload', variant: 'destructive' }); }
    finally { setImp(false); }
  };

  const handleEntityExport = (key: CsvKey) => {
    const { exportPath, filename, label } = CSV_CONFIG[key];
    downloadCsv(exportPath, filename, (v) => setCsvField(key, 'exporting', v), label);
  };

  const handleEntityFileChange = (key: CsvKey, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setCsvField(key, 'file', e.target.files[0]);
  };

  const handleEntityImport = (key: CsvKey) => {
    const { file } = csv[key];
    const { importPath } = CSV_CONFIG[key];
    if (file) uploadCsv(importPath, file, (v) => setCsvField(key, 'importing', v), () => setCsvField(key, 'file', null));
  };

  // ── Reset Data ────────────────────────────────────────────────────────────
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetAction, setResetAction] = useState<ResetAction | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetWithBackup, setResetWithBackup] = useState(true);

  const openResetDialog = (action: ResetAction) => { setResetAction(action); setResetConfirmText(''); setResetDialogOpen(true); };

  const handleResetData = async () => {
    if (!resetAction) return;
    setResetLoading(true);
    try {
      if (resetWithBackup) {
        try {
          const res = await fetch(getApiUrl('/settings/backup/manual'), { method: 'POST' });
          if (!res.ok) throw new Error('Automatic backup failed');
          toast({ title: 'Safety Backup Created', description: 'A backup was created before the reset action.' });
          fetchBackups();
        } catch (e) { console.error('Backup failed before reset:', e); }
      }
      const res = await fetch(getApiUrl('/data-management/reset'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: resetAction }) });
      const data = await res.json();
      if (res.ok) {
        toast({ title: 'Reset Successful', description: data.message });
        if (resetAction === 'factory_reset') {
          // Every user account is gone (only the installer's default admin is
          // back), so the stored session points at a user that no longer exists.
          try { localStorage.removeItem('mock-user-session'); } catch {}
          setTimeout(() => { window.location.href = '/login'; }, 1500);
        } else {
          setTimeout(() => window.location.reload(), 1500);
        }
      }
      else throw new Error(data.error || 'Reset failed');
    } catch (e: any) { toast({ title: 'Reset Failed', description: e.message, variant: 'destructive' }); }
    finally { setResetLoading(false); setResetDialogOpen(false); setResetAction(null); }
  };

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(getApiUrl('/settings/database'));
        if (res.ok) {
          const data = await res.json();
          setDbConfig(prev => ({ ...prev, host: data.host, port: data.port, user: data.user, database: data.database }));
        }
      } catch (e) { console.error('Failed to load database config', e); }
    };
    fetchConfig(); fetchBackups(); fetchSchedule();
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return {
    // connection
    loading, isTesting, connectionStatus, statusMessage, dbConfig,
    handleInputChange, testConnection, saveConfiguration,
    // backup
    backups, creatingBackup, restoringBackup, schedule, setSchedule, savingSchedule,
    restoreDialogOpen, setRestoreDialogOpen, backupToRestore,
    restoreConfirmText, setRestoreConfirmText,
    createBackup, saveSchedule, downloadBackup, openRestoreDialog, handleRestore, formatFileSize,
    // import/export
    exporting: csv.products.exporting, importFile: csv.products.file, importing: csv.products.importing,
    handleExport: () => handleEntityExport('products'),
    handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => handleEntityFileChange('products', e),
    uploadProducts: () => handleEntityImport('products'),
    customerExporting: csv.customers.exporting, customerImportFile: csv.customers.file, customerImporting: csv.customers.importing,
    handleCustomerExport: () => handleEntityExport('customers'),
    handleCustomerFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => handleEntityFileChange('customers', e),
    uploadCustomers: () => handleEntityImport('customers'),
    supplierExporting: csv.suppliers.exporting, supplierImportFile: csv.suppliers.file, supplierImporting: csv.suppliers.importing,
    handleSupplierExport: () => handleEntityExport('suppliers'),
    handleSupplierFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => handleEntityFileChange('suppliers', e),
    uploadSuppliers: () => handleEntityImport('suppliers'),
    // reset
    resetDialogOpen, setResetDialogOpen, resetAction, resetConfirmText, setResetConfirmText,
    resetLoading, resetWithBackup, setResetWithBackup, openResetDialog, handleResetData,
  };
}
