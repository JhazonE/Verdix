'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AlertCircle, Loader2, PlusCircle } from 'lucide-react';
import { useExternalApi } from './use-external-api';
import { ApiConnectionsTab } from './ApiConnectionsTab';
import { SyncLogsTab } from './SyncLogsTab';
import { ApiFormDialog } from './ApiFormDialog';

export default function ExternalApiSettingsPage() {
  const m = useExternalApi();

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">External API Integrations</h2>
        <Button onClick={m.openAddDialog}><PlusCircle className="mr-2 h-4 w-4" />Add API</Button>
      </div>

      {m.pendingCount > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30">
                <AlertCircle className="h-6 w-6" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  {m.pendingCount} item{m.pendingCount !== 1 && 's'} waiting to sync
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400">The system will automatically attempt to sync these in the background.</p>
              </div>
              <Button variant="outline" size="sm" className="border-amber-300 hover:bg-amber-100 dark:border-amber-800" onClick={() => m.fetchLogs()}>
                Refresh Status
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="apis" className="space-y-4">
        <TabsList>
          <TabsTrigger value="apis">API Connections</TabsTrigger>
          <TabsTrigger value="logs">Sync Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="apis" className="space-y-4">
          <ApiConnectionsTab
            apis={m.apis} isLoading={m.isLoadingApis} testingId={m.testingId}
            onAddApi={m.openAddDialog} onToggle={m.handleToggleEnabled}
            onEdit={m.openEditDialog} onDelete={m.setDeleteTarget} onTest={m.handleTestConnection}
          />
        </TabsContent>

        <TabsContent value="logs">
          <SyncLogsTab
            logs={m.logs} isLoading={m.isLoadingLogs}
            logStatusFilter={m.logStatusFilter} onStatusFilterChange={m.handleStatusFilterChange}
            onRefresh={() => m.fetchLogs()} retryingLogId={m.retryingLogId} onRetry={m.handleRetryLog}
            onClearLogs={m.clearLogs} isClearingLogs={m.isClearingLogs}
          />
        </TabsContent>
      </Tabs>

      <ApiFormDialog
        open={m.dialogOpen} onOpenChange={m.setDialogOpen}
        editingApi={m.editingApi} form={m.form} setForm={m.setForm}
        isSaving={m.isSaving} onSave={m.handleSave}
      />

      <AlertDialog open={!!m.deleteTarget} onOpenChange={open => !open && m.setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{m.deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this API configuration. Any sync operations using it will stop.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={m.handleDelete} disabled={m.isDeleting}>
              {m.isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
