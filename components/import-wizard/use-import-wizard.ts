'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getApiUrl } from '@/lib/api-config';
import {
  ENTITY_SCHEMAS,
  productsSchemaWithPriceLevels,
  type EntityKey,
  type ImportPriceLevel,
} from '@/lib/import/entity-schemas';
import { parseFile, type ParsedFile } from '@/lib/import/parse-file';
import { autoMapColumns } from '@/lib/import/auto-map';
import { classifyRows, type ClassifiedRow } from '@/lib/import/classify';
import { buildTemplateCsv, buildSkippedCsv } from '@/lib/import/csv-out';

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'result';

export interface ImportActivity { tag: 'Saved' | 'Skipped'; text: string }

/** Live numbers the "importing" screen renders while batches are in flight. */
export interface ImportProgress {
  done: number;        // valid rows already sent and answered
  total: number;       // valid rows that will be sent
  batch: number;       // 1-based batch currently saving
  batches: number;
  rangeFrom: number;   // 1-based row range of the current batch
  rangeTo: number;
  added: number;
  updated: number;
  skipped: number;
  etaSeconds: number | null;
  activity: ImportActivity[];  // newest first
  stopping: boolean;
}

const EMPTY_PROGRESS: ImportProgress = {
  done: 0, total: 0, batch: 0, batches: 0, rangeFrom: 0, rangeTo: 0,
  added: 0, updated: 0, skipped: 0, etaSeconds: null, activity: [], stopping: false,
};
const ACTIVITY_KEEP = 4;
// Each NEW product row costs ~12-17 sequential DB round trips (lookup upserts,
// match SELECTs, products + selling-unit + batch INSERTs, stock movement).
// Against a REMOTE MySQL (Railway) each trip is tens of ms, not the ~1ms a
// local socket gives, so a 500-row request ran for minutes and was killed by
// the platform's request timeout — surfacing as a bare "Import Failed" with
// every row in the chunk lost. 50 keeps a chunk well inside any edge timeout.
const BATCH = 50;

function downloadText(filename: string, text: string) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  URL.revokeObjectURL(url); document.body.removeChild(a);
}

export function useImportWizard(entity: EntityKey) {
  // Configured price levels become one optional column each (products only).
  // Loaded on mount rather than at file-pick time so "Download template"
  // already carries them on the very first step.
  const [priceLevels, setPriceLevels] = useState<ImportPriceLevel[]>([]);
  const schema = useMemo(
    () => (entity === 'products' ? productsSchemaWithPriceLevels(priceLevels) : ENTITY_SCHEMAS[entity]),
    [entity, priceLevels],
  );

  useEffect(() => {
    if (entity !== 'products') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getApiUrl('/data-management/import/products/price-levels'));
        if (!res.ok) return;
        const data = await res.json();
        // Price-level columns are a convenience, never a precondition: if this
        // fails the wizard stays on the static schema and the import still runs.
        if (!cancelled) setPriceLevels(Array.isArray(data?.levels) ? data.levels : []);
      } catch {
        /* keep the static schema */
      }
    })();
    return () => { cancelled = true; };
  }, [entity]);

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number } | null>(null);
  // Rows the SERVER rejected, mapped back to the source rows the user uploaded.
  // Without these, "Download skipped rows" only ever listed client-side
  // validation failures, so a row that passed validation and then failed to
  // insert was counted in `skipped` but appeared in no report at all.
  const [serverRejects, setServerRejects] = useState<ClassifiedRow[]>([]);
  const [progress, setProgress] = useState<ImportProgress>(EMPTY_PROGRESS);
  // A ref, not state: confirm()'s loop is one long async closure, so it must
  // read the CURRENT value between batches rather than the one it captured.
  const stopRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classified: ClassifiedRow[] = useMemo(() => {
    if (!parsed) return [];
    return classifyRows(parsed.rows, mapping, schema, existingKeys);
  }, [parsed, mapping, schema, existingKeys]);

  const counts = useMemo(() => ({
    new: classified.filter((r) => r.status === 'new').length,
    update: classified.filter((r) => r.status === 'update').length,
    error: classified.filter((r) => r.status === 'error').length,
  }), [classified]);

  async function pickFile(file: File) {
    setError(null);
    try {
      const pf = await parseFile(file);
      if (pf.rows.length === 0) { setError('No rows found in the file.'); return; }
      setParsed(pf);
      setMapping(autoMapColumns(pf.headers, schema.fields));
      const res = await fetch(getApiUrl(`/data-management/import/${entity}/keys`));
      const data = res.ok ? await res.json() : { keys: [] };
      setExistingKeys(new Set<string>(data.keys ?? []));
      setStep('map');
    } catch (e: any) {
      setError(e?.message || 'Could not read the file.');
    }
  }

  const requiredMapped = schema.fields.filter((f) => f.required).every((f) => mapping[f.key]);

  function toPreview() { if (requiredMapped) setStep('preview'); }
  function back() { setStep((s) => (s === 'preview' ? 'map' : s === 'map' ? 'upload' : s)); }

  async function confirm() {
    setLoading(true); setError(null);
    // Keep the full ClassifiedRow alongside the payload: the route reports
    // failures by index WITHIN the chunk it was sent, so mapping a rejection
    // back to the user's original spreadsheet row needs this parallel list.
    const validRows = classified.filter((r) => r.status !== 'error');
    const valid = validRows.map((r) => r.values);
    let added = 0, updated = 0, skipped = counts.error;
    const rejects: ClassifiedRow[] = [];
    setServerRejects([]);
    stopRef.current = false;
    const batches = Math.max(1, Math.ceil(valid.length / BATCH));
    const startedAt = Date.now();
    let activity: ImportActivity[] = [];
    const pushActivity = (items: ImportActivity[]) => {
      activity = [...items.reverse(), ...activity].slice(0, ACTIVITY_KEEP);
    };
    const publish = (done: number, batch: number, from: number, to: number) => {
      const elapsed = (Date.now() - startedAt) / 1000;
      // No estimate until a batch has actually completed: a guess from zero
      // data would flash a meaningless number.
      const etaSeconds = done > 0 && valid.length > done
        ? Math.round((elapsed / done) * (valid.length - done)) : null;
      setProgress({
        done, total: valid.length, batch, batches, rangeFrom: from, rangeTo: to,
        added, updated, skipped, etaSeconds, activity, stopping: stopRef.current,
      });
    };
    setStep('importing');
    publish(0, 1, 1, Math.min(BATCH, valid.length));
    try {
      for (let i = 0; i < valid.length; i += BATCH) {
        // Stop is honoured BETWEEN batches only: a batch already sent is
        // committing server-side and cannot be recalled, so pretending to
        // cancel it would misreport what is saved.
        if (stopRef.current) {
          throw new Error(
            `Stopped by you before rows ${i + 1}-${valid.length}. ` +
            `${added} added, ${updated} updated so far — those are saved.`,
          );
        }
        const batchNo = Math.floor(i / BATCH) + 1;
        publish(i, batchNo, i + 1, Math.min(i + BATCH, valid.length));
        const chunk = valid.slice(i, i + BATCH);
        const res = await fetch(getApiUrl(`/data-management/import/${entity}`), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        });
        if (!res.ok) {
          // Report WHAT failed and WHERE. A bare "Import request failed" gave
          // no way to tell a timeout from a schema error from a bad row, which
          // is what made this unfixable from the UI alone. Reading the body is
          // best-effort: a platform timeout returns an HTML error page, not the
          // route's JSON.
          let detail = '';
          try {
            const body = await res.json();
            detail = body?.error || body?.message || '';
          } catch {
            detail = res.statusText || '';
          }
          const at = `rows ${i + 1}-${Math.min(i + BATCH, valid.length)} of ${valid.length}`;
          throw new Error(
            `Import stopped at ${at} (HTTP ${res.status}${detail ? `: ${detail}` : ''}). ` +
            `${added} added, ${updated} updated so far — those are saved.`,
          );
        }
        const data = await res.json();
        added += data.added ?? 0; updated += data.updated ?? 0; skipped += data.skipped ?? 0;
        // `row` is the index inside this chunk; offset it to recover the row the
        // user actually uploaded, then carry the server's reason onto it.
        const batchActivity: ImportActivity[] = [];
        for (const e of (data.errors ?? []) as Array<{ row: number; reason: string }>) {
          const source = validRows[i + e.row];
          if (source) {
            rejects.push({ ...source, status: 'error', reason: e.reason });
            batchActivity.push({ tag: 'Skipped', text: `Row ${source.sourceIndex + 2} · ${e.reason}` });
          }
        }
        batchActivity.push({ tag: 'Saved', text: `Batch ${batchNo} · ${chunk.length - (data.skipped ?? 0)} of ${chunk.length} rows committed` });
        pushActivity(batchActivity);
        // Surface progress as it lands so a long import is visibly advancing
        // and a later failure still shows what already committed.
        setResult({ added, updated, skipped });
        setServerRejects([...rejects]);
        publish(Math.min(i + BATCH, valid.length), batchNo, i + 1, Math.min(i + BATCH, valid.length));
      }
      setResult({ added, updated, skipped });
      setStep('result');
    } catch (e: any) {
      setError(e?.message || 'Import failed.');
      // Still advance to the result step. Anything already committed is real,
      // and staying on the preview hid both that progress and the skipped-rows
      // download — leaving the user to guess what landed and re-import blind.
      // The error banner above the summary says it stopped early.
      if (added > 0 || updated > 0 || skipped > 0) {
        setResult({ added, updated, skipped });
        setStep('result');
      } else {
        // Nothing landed: go back to the preview (as before this screen
        // existed) rather than strand the user on a progress view that will
        // never advance. The error banner explains why.
        setStep('preview');
      }
    } finally {
      setLoading(false);
    }
  }

  function stop() {
    stopRef.current = true;
    setProgress((p) => ({ ...p, stopping: true }));
  }

  function downloadTemplate() { downloadText(`${entity}-template.csv`, buildTemplateCsv(schema)); }
  function downloadSkipped() {
    // Both kinds of skip belong in one report: rows rejected by validation
    // before sending, and rows the database refused once sent.
    const csv = buildSkippedCsv([...classified, ...serverRejects]);
    if (csv) downloadText(`${entity}-skipped-rows.csv`, csv);
  }
  function reset() {
    setStep('upload'); setParsed(null); setMapping({}); setExistingKeys(new Set());
    setResult(null); setError(null); setServerRejects([]);
    setProgress(EMPTY_PROGRESS); stopRef.current = false;
  }

  return {
    step, schema, parsed, mapping, setMapping, classified, counts, result, loading, error, requiredMapped, progress,
    actions: { pickFile, back, toPreview, confirm, stop, downloadTemplate, downloadSkipped, reset },
  };
}
