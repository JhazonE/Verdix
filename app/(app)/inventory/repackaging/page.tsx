'use client';

import { useState, useEffect } from 'react';
import { Scissors, RefreshCw, History, Scissors as ScissorsIcon, ArrowRight, Clock, CheckCircle2, PackagePlus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UnitRepackForm } from './unit-repack-form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getRepackagingHistory, type RepackagingLog } from './actions';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

function RepackagingHistoryTable() {
  const [logs, setLogs] = useState<RepackagingLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const data = await getRepackagingHistory(100);
      setLogs(data);
    } catch {
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Loading history...</p>
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed rounded-2xl border-muted-foreground/10">
        <History className="h-12 w-12 text-muted-foreground/20 mb-4" />
        <p className="font-bold text-muted-foreground">No repackaging history yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Completed repackaging and consolidation sessions will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">{logs.length} total sessions recorded</p>
        <Button variant="outline" size="sm" onClick={fetchLogs} className="h-7 gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Header */}
      <div className="hidden md:grid grid-cols-13 text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 px-4 pb-1" style={{ gridTemplateColumns: 'repeat(13, 1fr)' }}>
        <span className="col-span-1">Date</span>
        <span className="col-span-1">Type</span>
        <span className="col-span-3">Source Product</span>
        <span className="col-span-1 text-right">Qty Used</span>
        <span className="col-span-1 text-center">→</span>
        <span className="col-span-3">Target Product</span>
        <span className="col-span-1 text-right">Produced</span>
        <span className="col-span-1 text-right">Factor</span>
        <span className="col-span-1 text-center">Status</span>
      </div>

      <ScrollArea className="h-[500px] pr-2">
        <div className="space-y-2">
          {logs.map((log) => {
            const isConsolidate = log.direction === 'consolidate';
            return (
              <div
                key={log.id}
                className={cn(
                  'grid items-center p-3 bg-card rounded-xl border hover:border-primary/20 transition-colors text-sm gap-1',
                  isConsolidate ? 'border-violet-200/60 dark:border-violet-800/40' : 'border-border/50'
                )}
                style={{ gridTemplateColumns: 'repeat(13, 1fr)' }}
              >
                <div className="col-span-12 md:col-span-1 text-[10px] text-muted-foreground font-mono">
                  {new Date(log.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                  <div className="text-[9px] opacity-60">{new Date(log.createdAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>

                {/* Direction Badge */}
                <div className="col-span-1 hidden md:flex justify-center">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] py-0.5 px-1.5 font-bold',
                      isConsolidate
                        ? 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-700'
                        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-700'
                    )}
                  >
                    {isConsolidate ? '↑ Merge' : '↓ Break'}
                  </Badge>
                </div>

                <div className="col-span-5 md:col-span-3 font-semibold truncate flex items-center gap-1.5">
                  <div className={cn(
                    'h-7 w-7 rounded-lg flex items-center justify-center shrink-0',
                    isConsolidate ? 'bg-violet-500/10' : 'bg-primary/10'
                  )}>
                    {isConsolidate
                      ? <PackagePlus className="h-3.5 w-3.5 text-violet-600" />
                      : <ScissorsIcon className="h-3.5 w-3.5 text-primary" />
                    }
                  </div>
                  <span className="truncate">
                    {log.sourceProductName}
                    {log.sourceUnitName && (
                      <span className="text-muted-foreground font-normal"> ({log.sourceUnitName})</span>
                    )}
                  </span>
                </div>

                <div className={cn(
                  'col-span-3 md:col-span-1 text-right font-black',
                  isConsolidate ? 'text-violet-600' : 'text-primary'
                )}>
                  -{log.sourceQty}
                </div>

                <div className="col-span-1 text-center text-muted-foreground/40">
                  <ArrowRight className="h-4 w-4 mx-auto" />
                </div>

                <div className="col-span-8 md:col-span-3 font-semibold truncate flex items-center gap-1.5">
                  <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                  <span className="truncate">
                    {log.targetProductName}
                    {log.targetUnitName && (
                      <span className="text-muted-foreground font-normal"> ({log.targetUnitName})</span>
                    )}
                    {!!log.shortfallBaseQty && (
                      <span className="ml-1 text-[10px] font-normal text-amber-600">
                        {log.shortfallBaseQty} short
                      </span>
                    )}
                  </span>
                </div>

                <div className="col-span-3 md:col-span-1 text-right font-black text-emerald-600">
                  +{log.targetQtyProduced}
                </div>

                <div className="col-span-3 md:col-span-1 text-right text-xs text-muted-foreground">
                  <span className="bg-muted/50 px-1.5 py-0.5 rounded font-mono">{log.factor.toFixed(2)}x</span>
                </div>

                <div className="col-span-3 md:col-span-1 text-center">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] py-0.5 font-bold capitalize',
                      log.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      log.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-secondary/50 text-muted-foreground'
                    )}
                  >
                    {log.status === 'completed' ? <CheckCircle2 className="h-2.5 w-2.5 mr-1 inline" /> : <Clock className="h-2.5 w-2.5 mr-1 inline" />}
                    {log.status}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function RepackagingPage() {
  const [formKey, setFormKey] = useState(0);
  const [activeTab, setActiveTab] = useState('repackage');

  const handleSuccess = () => {
    setActiveTab('history');
    setFormKey(prev => prev + 1);
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Repackaging</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Open a case into pieces, or merge pieces back into cases. Stock stays one shared count.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="h-10">
          <TabsTrigger value="repackage" className="gap-2">
            <Scissors className="h-4 w-4" /> Repackage
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" /> History
          </TabsTrigger>
        </TabsList>

        {/* ── REPACKAGE ── */}
        <TabsContent value="repackage" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scissors className="h-5 w-5 text-primary" />
                Repackage
              </CardTitle>
              <CardDescription>
                Convert between a product's selling units — for example 1 Case into 24 Pieces.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UnitRepackForm key={formKey} onSuccess={handleSuccess} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── HISTORY ── */}
        <TabsContent value="history" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                Repackaging History
              </CardTitle>
              <CardDescription>
                Full log of all break pack and consolidation sessions, with direction indicators.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RepackagingHistoryTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
