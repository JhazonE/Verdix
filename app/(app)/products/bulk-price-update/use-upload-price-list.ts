'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { useToast } from '@/hooks/use-toast';

export interface PreviewSummary {
  matched: number;
  toCreate: number;
  skipped: number;
  matchedSample: any[];
  toCreateSample: any[];
  skippedRows: { row: any; reason: string }[];
}

export interface Progress { phase: string; done: number; total: number }

/**
 * Reads an NDJSON stream, invoking `onFrame` per line. Buffers partial lines:
 * a chunk boundary can fall mid-line, so lines are only parsed once terminated.
 */
async function readNdjson(response: Response, onFrame: (frame: any) => void) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onFrame(JSON.parse(line));
  }
  if (buffer.trim()) onFrame(JSON.parse(buffer));
}

export function useUploadPriceList(warehouseId: string, onUpdated?: () => void) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const { toast } = useToast();

  const post = async (theFile: File, mode: 'preview' | 'apply', userId: string) => {
    const form = new FormData();
    form.append('file', theFile);
    form.append('warehouseId', warehouseId);
    form.append('userId', userId);
    form.append('mode', mode);
    if (confirmCreate) form.append('confirmCreate', '1');

    const response = await fetch('/api/products/price-list/process', { method: 'POST', body: form });
    // Errors raised before streaming starts (approval gate, unreadable file)
    // come back as ordinary JSON, not as a stream.
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: 'Upload failed.' }));
      throw new Error(body.message || 'Upload failed.');
    }

    let final: any = null;
    await readNdjson(response, (frame) => {
      if (frame.phase === 'applying' || frame.phase === 'matching') {
        setProgress({ phase: frame.phase, done: frame.done, total: frame.total });
      } else if (frame.phase === 'parsing') {
        setProgress({ phase: 'parsing', done: 0, total: frame.total ?? 0 });
      } else if (frame.phase === 'error') {
        throw new Error(frame.message);
      } else if (frame.phase === 'done') {
        final = frame;
      }
    });
    return final;
  };

  const handleFile = async (theFile: File) => {
    setIsParsing(true);
    setPreview(null);
    setConfirmCreate(false);
    setProgress(null);
    setFile(theFile);
    try {
      const result = await post(theFile, 'preview', 'system');
      setPreview(result);
    } catch (err: any) {
      setFile(null);
      toast({ variant: 'destructive', title: 'Failed to read file', description: err.message || String(err) });
    } finally {
      setIsParsing(false);
      setProgress(null);
    }
  };

  const submit = async (userId: string) => {
    if (!file || !preview) return null;
    if (preview.toCreate > 0 && !confirmCreate) return null;
    setIsSubmitting(true);
    try {
      const result = await post(file, 'apply', userId);
      const parts: string[] = [];
      // Always state real counts first, even when result.error is set — those
      // chunks already committed to the database, so the user must see what
      // actually happened to their prices, never just "Error".
      parts.push(`Updated ${result.applied || 0} product(s)`);
      parts.push(`Created ${result.created || 0}`);
      if (result.skipped > 0) parts.push(`${result.skipped} row(s) skipped`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.error) parts.push(`Stopped early: ${result.error}`);
      toast({
        variant: (result.failed > 0 || result.error) ? 'destructive' : undefined,
        title: result.error ? 'Stopped with partial results' : (result.failed > 0 ? 'Completed with issues' : 'Price list processed'),
        description: parts.join('. ') || 'Nothing to do.',
      });
      setPreview(null);
      setFile(null);
      setConfirmCreate(false);
      onUpdated?.();
      return result;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to submit price list.' });
      return null;
    } finally {
      setIsSubmitting(false);
      setProgress(null);
    }
  };

  const downloadSkippedCsv = () => {
    if (!preview?.skippedRows?.length) return;
    const data = preview.skippedRows.map(s => ({
      sku: s.row?.sku ?? '', barcode: s.row?.barcode ?? '', name: s.row?.name ?? '',
      new_price: s.row?.newPrice ?? '', new_cost: s.row?.newCost ?? '',
      new_markup_pct: s.row?.newMarkupPct ?? '', reason: s.reason,
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Skipped');
    XLSX.writeFile(wb, 'skipped-rows.csv', { bookType: 'csv' });
  };

  return {
    file, preview, confirmCreate, setConfirmCreate, isParsing, isSubmitting, progress,
    handleFile, submit, downloadSkippedCsv,
    reset: () => { setPreview(null); setFile(null); setConfirmCreate(false); setProgress(null); },
  };
}
