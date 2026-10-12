'use client';

import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { EntityKey } from '@/lib/import/entity-schemas';
import { useImportWizard } from './use-import-wizard';

interface Props {
  entity: EntityKey;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}

export function ImportWizard({ entity, open, onOpenChange, onImported }: Props) {
  const w = useImportWizard(entity);
  const fileRef = useRef<HTMLInputElement>(null);

  function close() { w.actions.reset(); onOpenChange(false); }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import {w.schema.label}</DialogTitle>
        </DialogHeader>

        {w.error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            <AlertTriangle className="h-4 w-4" /> {w.error}
          </div>
        )}

        {/* STEP 1: UPLOAD */}
        {w.step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a CSV or Excel (.xlsx) file. Not sure about the columns? Download the template first.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={w.actions.downloadTemplate}>
                <Download className="mr-2 h-4 w-4" /> Download template
              </Button>
            </div>
            <input
              ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) w.actions.pickFile(f); e.target.value = ''; }}
            />
            <Button className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Choose file
            </Button>
          </div>
        )}

        {/* STEP 2: MAP */}
        {w.step === 'map' && w.parsed && (
          <div className="space-y-3 max-h-[60vh] overflow-auto">
            <p className="text-sm text-muted-foreground">Match your file's columns to the fields below. Required fields are marked *.</p>
            {w.schema.fields.map((f) => (
              <div key={f.key} className="grid grid-cols-2 items-center gap-2">
                <label className="text-sm">
                  {f.label}{f.required && <span className="text-red-600"> *</span>}
                  {w.mapping[f.key] && <Badge variant="secondary" className="ml-2 text-[10px]">auto</Badge>}
                </label>
                <select
                  className="border rounded h-9 px-2 text-sm bg-background"
                  value={w.mapping[f.key] ?? ''}
                  onChange={(e) => w.setMapping({ ...w.mapping, [f.key]: e.target.value || null })}
                >
                  <option value="">— Not mapped —</option>
                  {w.parsed!.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
            <DialogFooter className="pt-2">
              <Button variant="ghost" onClick={w.actions.back}>Back</Button>
              <Button onClick={w.actions.toPreview} disabled={!w.requiredMapped}>Next: Preview</Button>
            </DialogFooter>
            {!w.requiredMapped && <p className="text-xs text-red-600">Map all required (*) fields to continue.</p>}
          </div>
        )}

        {/* STEP 3: PREVIEW */}
        {w.step === 'preview' && (
          <div className="space-y-3">
            <div className="flex gap-2 text-sm">
              <Badge className="bg-green-600">{w.counts.new} new</Badge>
              <Badge className="bg-blue-600">{w.counts.update} update</Badge>
              <Badge variant="destructive">{w.counts.error} skipped</Badge>
            </div>
            <div className="max-h-[50vh] overflow-auto border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr><th className="text-left p-2">#</th><th className="text-left p-2">Status</th><th className="text-left p-2">Name</th><th className="text-left p-2">Reason</th></tr>
                </thead>
                <tbody>
                  {w.classified.map((r) => (
                    <tr key={r.sourceIndex} className="border-t">
                      <td className="p-2">{r.sourceIndex + 1}</td>
                      <td className="p-2">{r.status}</td>
                      <td className="p-2">{String(r.values.name ?? '')}</td>
                      <td className="p-2 text-red-600">{r.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={w.actions.back}>Back</Button>
              <Button onClick={w.actions.confirm} disabled={w.loading || (w.counts.new + w.counts.update === 0)}>
                {w.loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                Import {w.counts.new + w.counts.update} rows
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* STEP 4: RESULT */}
        {w.step === 'result' && w.result && (
          <div className="space-y-4">
            {/* An import that stopped early still lands here so its partial
                progress and skipped-rows report stay reachable — but it must
                not claim to have completed. The error banner above carries the
                reason and where it stopped. */}
            {w.error ? (
              <div className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">Import stopped before finishing</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Import complete</span>
              </div>
            )}
            <p className="text-sm">Added: {w.result.added} · Updated: {w.result.updated} · Skipped: {w.result.skipped}</p>
            {w.result.skipped > 0 && (
              <Button variant="outline" onClick={w.actions.downloadSkipped}>
                <Download className="mr-2 h-4 w-4" /> Download skipped rows
              </Button>
            )}
            <DialogFooter>
              <Button onClick={() => { onImported?.(); close(); }}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
