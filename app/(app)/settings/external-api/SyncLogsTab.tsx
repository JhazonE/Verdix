'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { AlertCircle, Ban, CheckCircle2, Eye, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { ApiSyncLog } from '@/lib/services/api-sync-logger';

/** Payload/response are stored as raw text; pretty-print when they're JSON, show as-is otherwise. */
function formatLogBody(raw: string | null | undefined): string {
  if (!raw) return '(empty)';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

interface Props {
  logs: ApiSyncLog[];
  isLoading: boolean;
  logStatusFilter: string;
  onStatusFilterChange: (v: string) => void;
  onRefresh: () => void;
  retryingLogId: string | null;
  onRetry: (log: ApiSyncLog) => void;
  onClearLogs: () => void;
  isClearingLogs: boolean;
}

export function SyncLogsTab({ logs, isLoading, logStatusFilter, onStatusFilterChange, onRefresh, retryingLogId, onRetry, onClearLogs, isClearingLogs }: Props) {
  const [confirmText, setConfirmText] = useState('');
  const [viewLog, setViewLog] = useState<ApiSyncLog | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Synchronization History</CardTitle>
          <CardDescription>Recent API calls and their status.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={logStatusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <AlertDialog onOpenChange={(open) => { if (!open) setConfirmText(''); }}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isClearingLogs}>
                {isClearingLogs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Clear Logs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear sync logs?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes all <strong>success</strong> entries.{' '}
                  <strong>Pending</strong> and <strong>failed</strong> entries are kept — they are still queued for retry.
                  This cannot be undone. Type <strong>CLEAR</strong> to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type CLEAR"
                autoComplete="off"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={confirmText !== 'CLEAR'} onClick={onClearLogs}>
                  Clear Logs
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative w-full overflow-auto">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b">
                {['Time', 'Type', 'Reference', 'Status', 'Attempts', 'Next Retry', 'Error', 'Action'].map(h => (
                  <th key={h} className="h-12 px-4 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={8} className="h-24 text-center text-muted-foreground">No sync logs found.</td></tr>
              ) : logs.map(log => (
                <tr key={log.id} className="border-b transition-colors hover:bg-muted/50">
                  <td className="p-4 text-xs">{new Date(log.createdAt || '').toLocaleString()}</td>
                  <td className="p-4"><Badge variant="outline">{log.transactionType}</Badge></td>
                  <td className="p-4 font-mono text-xs">{log.transactionId}</td>
                  <td className="p-4">
                    {log.status === 'success' ? (
                      <Badge className="bg-emerald-500 hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" /> Success</Badge>
                    ) : log.status === 'failed' ? (
                      <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" /> Failed</Badge>
                    ) : log.status === 'abandoned' ? (
                      // Terminal: retrying can never succeed (e.g. the record the
                      // log points at was deleted), so the sweep skips it and no
                      // Retry button is offered below. The Error column says why.
                      <Badge variant="outline" className="text-muted-foreground"><Ban className="mr-1 h-3 w-3" /> Abandoned</Badge>
                    ) : (
                      <Badge variant="secondary">Pending</Badge>
                    )}
                  </td>
                  <td className="p-4 text-center">{(log.retryCount ?? 0) + 1}</td>
                  <td className="p-4 text-xs">{log.nextRetryAt ? new Date(log.nextRetryAt).toLocaleTimeString() : '-'}</td>
                  <td className="p-4 max-w-[200px] truncate text-xs text-destructive">{log.errorMessage || '-'}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setViewLog(log)} title="View sent data">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {(log.status === 'failed' || log.status === 'pending') && (
                        <Button variant="outline" size="sm" onClick={() => onRetry(log)} disabled={retryingLogId === log.id}>
                          {retryingLogId === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={!!viewLog} onOpenChange={(open) => { if (!open) setViewLog(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewLog?.transactionId}</DialogTitle>
            <DialogDescription>
              {viewLog?.transactionType} · {viewLog?.endpoint}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-sm font-medium">Payload sent</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
                {formatLogBody(viewLog?.payload)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">Response received</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
                {formatLogBody(viewLog?.response)}
              </pre>
            </div>
            {viewLog?.errorMessage && (
              <div>
                <p className="mb-1 text-sm font-medium text-destructive">Error</p>
                <pre className="max-h-32 overflow-auto rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                  {viewLog.errorMessage}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
