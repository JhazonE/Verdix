'use client';

import { useEffect, useMemo, useState } from 'react';
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

type Step = 'upload' | 'map' | 'preview' | 'result';
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
    try {
      for (let i = 0; i < valid.length; i += BATCH) {
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
        for (const e of (data.errors ?? []) as Array<{ row: number; reason: string }>) {
          const source = validRows[i + e.row];
          if (source) rejects.push({ ...source, status: 'error', reason: e.reason });
        }
        // Surface progress as it lands so a long import is visibly advancing
        // and a later failure still shows what already committed.
        setResult({ added, updated, skipped });
        setServerRejects([...rejects]);
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
      }
    } finally {
      setLoading(false);
    }
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
  }

  return {
    step, schema, parsed, mapping, setMapping, classified, counts, result, loading, error, requiredMapped,
    actions: { pickFile, back, toPreview, confirm, downloadTemplate, downloadSkipped, reset },
  };
}
