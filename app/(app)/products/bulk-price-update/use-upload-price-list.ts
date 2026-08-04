'use client';

import { useState } from 'react';
import { parseFile } from '@/lib/import/parse-file';
import { previewPriceListUpload, submitPriceUpdateBatch, type PriceUpdateItem, type PriceListPreviewResult } from './actions';
import { mapParsedRowsToPriceListRows } from './price-list-template';
import { useToast } from '@/hooks/use-toast';

export function useUploadPriceList(warehouseId: string, onUpdated?: () => void) {
  const [preview, setPreview] = useState<PriceListPreviewResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setIsParsing(true);
    setPreview(null);
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
    if (!preview || preview.matched.length === 0) return null;
    setIsSubmitting(true);
    try {
      const items: PriceUpdateItem[] = preview.matched;
      const result = await submitPriceUpdateBatch(warehouseId, items, userId);
      if (result.success) {
        toast({
          title: result.pendingApproval ? 'Submitted for approval' : 'Prices updated',
          description: result.message,
        });
        setPreview(null);
        onUpdated?.();
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to submit price update.' });
      }
      return result;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to submit price update.' });
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { preview, isParsing, isSubmitting, handleFile, submit, reset: () => setPreview(null) };
}
