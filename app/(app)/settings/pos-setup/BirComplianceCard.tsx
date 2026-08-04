'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import { getApiUrl } from '@/lib/api-config';
import type { PosSettings } from './pos-setup-types';

type SetFn = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => void;

interface Props { settings: PosSettings; set: SetFn; }

export function BirComplianceCard({ settings, set }: Props) {
  const downloadEJournal = async () => {
    const date = (document.getElementById('ejournal-date') as HTMLInputElement)?.value;
    if (!date) return;
    try {
      const res = await fetch(getApiUrl('/sales/ejournal/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, terminalId: 'all' }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`E-Journal saved (${data.files.length} files) to:\n${data.dir}`);
      } else {
        alert(`Failed to save e-journal: ${data.error || 'unknown error'}`);
      }
    } catch (e: any) {
      alert(`Failed to save e-journal: ${e.message}`);
    }
  };

  return (
    <Card className="border-blue-200 bg-blue-50/30 dark:border-blue-500/30 dark:bg-blue-500/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
          <FileText className="h-5 w-5" />
          BIR Compliance (RMO 24-2023)
        </CardTitle>
        <CardDescription>Features required for BIR Cashering / POS System compliance</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-blue-700/70 dark:text-blue-300/70">
          MIN, Serial Number, BIR Accreditation No., and Permit to Use (PTU) No. + Date Issued are configured
          per machine under Settings → POS Terminals, since each accredited unit has its own.
        </p>

        <div className="flex items-center justify-between pt-4 border-t border-blue-100 dark:border-blue-500/20">
          <div className="space-y-0.5">
            <Label htmlFor="isTrainingMode" className="text-blue-900 dark:text-blue-200 font-semibold">Training Mode</Label>
            <p className="text-sm text-blue-700/70 dark:text-blue-300/70">
              Transactions made in Training Mode are tagged and excluded from official totals.
              <br /><span className="text-xs font-bold text-red-600 dark:text-red-400 font-mono">WARNING: TURN OFF BEFORE ACTUAL DEPLOYMENT</span>
            </p>
          </div>
          <Switch id="isTrainingMode" checked={!!settings.isTrainingMode} onCheckedChange={v => set('isTrainingMode', v)} className="data-[state=checked]:bg-blue-600" />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-blue-100 dark:border-blue-500/20">
          <div className="space-y-0.5">
            <Label className="text-blue-900 dark:text-blue-200 font-semibold">Electronic Journal (e-Journal)</Label>
            <p className="text-sm text-blue-700/70 dark:text-blue-300/70">Generate daily transaction logs for BIR audit (RMO No. 24-2023)</p>
          </div>
          <div className="flex gap-2">
            <Input type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-[150px] bg-white dark:bg-blue-500/10 dark:border-blue-500/30" id="ejournal-date" />
            <Button variant="outline" size="sm" className="border-blue-200 text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/20" onClick={downloadEJournal}>
              Save E-Journal
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
