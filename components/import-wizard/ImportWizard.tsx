'use client';

import { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Download, Upload, RefreshCw, CheckCircle2, AlertTriangle, Check } from 'lucide-react';
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

  const importing = w.step === 'importing';
  const pr = w.progress;
  const percent = pr.total > 0 ? Math.min(100, Math.floor((pr.done / pr.total) * 100)) : 0;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const eta = pr.etaSeconds == null ? null
    : pr.etaSeconds >= 60 ? `${Math.ceil(pr.etaSeconds / 60)} min` : `${Math.max(1, pr.etaSeconds)} sec`;
  // Reading and checking happen before this screen, so those two are always
  // complete here; "Saving" is the live one.
  const stages = ['Read file', 'Check rows', `Save ${w.schema.label.toLowerCase()} to database`, 'Finish'];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (v) onOpenChange(v); else if (!importing) close(); }}>
      <DialogContent className="max-w-3xl" onInteractOutside={(e) => { if (importing) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (importing) e.preventDefault(); }}>
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

        {/* STEP 3b: IMPORTING (live) */}
        {importing && (
          <div className="space-y-5" aria-live="polite">
            <div className="rounded-xl border bg-muted/40 p-5 space-y-3">
              <div className="flex items-end justify-between gap-4">
                <div className="text-5xl font-bold leading-none tracking-tight tabular-nums">
                  {percent}<span className="text-2xl text-muted-foreground">%</span>
                </div>
                <div className="text-right text-sm text-muted-foreground leading-relaxed">
                  <div><strong className="text-foreground tabular-nums">{fmt(pr.done)}</strong> of {fmt(pr.total)} rows</div>
                  <div>{eta ? `About ${eta} left` : 'Estimating time…'}</div>
                </div>
              </div>
              <Progress value={percent} className="h-3" aria-label="Import progress" />
              <div className="text-xs text-muted-foreground">
                Batch {pr.batch} of {pr.batches} · rows {fmt(pr.rangeFrom)}–{fmt(pr.rangeTo)}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <div className="text-xs font-medium text-green-800">Added</div>
                <div className="text-2xl font-bold text-green-900 tabular-nums">{fmt(pr.added)}</div>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                <div className="text-xs font-medium text-blue-800">Updated</div>
                <div className="text-2xl font-bold text-blue-900 tabular-nums">{fmt(pr.updated)}</div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-xs font-medium text-amber-800">Skipped</div>
                <div className="text-2xl font-bold text-amber-900 tabular-nums">{fmt(pr.skipped)}</div>
              </div>
            </div>

            <ol className="space-y-2 text-sm">
              {stages.map((label, i) => {
                const active = i === 2 && percent < 100;
                const done = i < 2 || (i === 2 && percent >= 100);
                return (
                  <li key={label} className="flex items-center gap-3">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                        done ? 'bg-green-600 border-green-600 text-white' : active ? 'border-blue-600' : 'border-slate-300'
                      }`}
                    >
                      {done && <Check className="h-3 w-3" strokeWidth={3.5} />}
                      {active && <RefreshCw className="h-2.5 w-2.5 animate-spin text-blue-600" />}
                    </span>
                    <span className={done || active ? (active ? 'font-semibold' : '') : 'text-muted-foreground'}>{label}</span>
                  </li>
                );
              })}
            </ol>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-700">Latest activity</div>
              <div className="min-h-[5.5rem] rounded-lg border px-3 py-2 text-xs text-muted-foreground space-y-1">
                {pr.activity.length === 0 && <div>Waiting for the first batch…</div>}
                {pr.activity.map((a, i) => (
                  <div key={i} className="flex gap-3">
                    <span className={`min-w-[3.5rem] font-semibold ${a.tag === 'Skipped' ? 'text-amber-700' : 'text-green-700'}`}>{a.tag}</span>
                    <span className="break-words">{a.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter className="items-center sm:justify-between gap-3">
              <p className="text-xs text-muted-foreground max-w-xs">
                Keep this window open. Rows already saved stay saved if you stop.
              </p>
              <Button variant="outline" onClick={w.actions.stop} disabled={pr.stopping}>
                {pr.stopping ? 'Stopping after this batch…' : 'Stop after this batch'}
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
