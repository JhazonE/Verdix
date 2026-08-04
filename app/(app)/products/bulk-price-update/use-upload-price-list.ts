'use client';

import { useState } from 'react';
import { parseFile } from '@/lib/import/parse-file';
import { previewPriceListUpload, submitPriceUpdateBatch, createProductsFromExcel, type PriceUpdateItem, type PriceListPreviewResult } from './actions';
import { mapParsedRowsToPriceListRows } from './price-list-template';
import { useToast } from '@/hooks/use-toast';

export function useUploadPriceList(warehouseId: string, onUpdated?: () => void) {
  const [preview, setPreview] = useState<PriceListPreviewResult | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setPreview(null);
    setConfirmCreate(false);
    try {
      const parsed = await parseFile(file);
      const rows = mapParsedRowsToPriceListRows(parsed);
      const result = await previewPriceListUpload(warehouseId, rows);
      setPreview(result);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed to read file', description: err.message || String(err) });
    } finally {
      setIsParsing(false);
    }
  };

  const submit = async (userId: string) => {
    if (!preview || (preview.matched.length === 0 && preview.toCreate.length === 0)) return null;
    if (preview.toCreate.length > 0 && !confirmCreate) return null;
    setIsSubmitting(true);
    try {
      const items: PriceUpdateItem[] = preview.matched;
      const updateResult = items.length > 0 ? await submitPriceUpdateBatch(warehouseId, items, userId) : null;
      const createResult = preview.toCreate.length > 0 ? await createProductsFromExcel(warehouseId, preview.toCreate, userId) : null;

      const parts: string[] = [];
      if (updateResult) parts.push(updateResult.pendingApproval ? `${items.length} update(s) submitted for approval` : `Updated ${updateResult.applied ?? 0} product(s)`);
      if (createResult) {
        if (createResult.created > 0) parts.push(`Created ${createResult.created} new product(s)`);
        if (createResult.pendingApproval > 0) parts.push(`${createResult.pendingApproval} new product(s) submitted for approval`);
        if (createResult.failed.length > 0) parts.push(`${createResult.failed.length} new product(s) failed`);
      }

      const anyFailure = (updateResult && !updateResult.success) || (createResult && createResult.failed.length > 0 && createResult.created === 0 && createResult.pendingApproval === 0);
      toast({
        variant: anyFailure ? 'destructive' : undefined,
        title: anyFailure ? 'Completed with issues' : 'Price list processed',
        description: parts.join('. ') || 'Nothing to do.',
      });
      setPreview(null);
      setConfirmCreate(false);
      onUpdated?.();
      return { updateResult, createResult };
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to submit price list.' });
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { preview, confirmCreate, setConfirmCreate, isParsing, isSubmitting, handleFile, submit, reset: () => { setPreview(null); setConfirmCreate(false); } };
}
