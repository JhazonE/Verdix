'use client';

import { useCallback, useEffect, useState } from 'react';

export interface InventoryBatch {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  purchase_order_id: string | null;
  po_reference: string | null;
  received_date: string;
  quantity_in: number;
  quantity_remaining: number;
  unit_cost: number;
  selling_price: number;
  source_type: string;
  notes: string | null;
  created_at: string;
  expirationDate: string | null;
}

export function useBatchInventory(open: boolean) {
  const [batches, setBatches] = useState<InventoryBatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'exhausted'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadBatches = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        status: statusFilter,
        page: String(currentPage),
        pageSize: String(pageSize),
      });
      const res = await fetch(`/api/inventory-batches?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setBatches(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setBatches([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter, currentPage, pageSize]);

  useEffect(() => {
    if (open) setCurrentPage(1);
  }, [open, search, statusFilter, pageSize]);

  useEffect(() => {
    if (open) loadBatches();
  }, [open, loadBatches]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const handleStatusFilter = (value: 'all' | 'active' | 'exhausted') => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handlePageSize = (value: string) => {
    setPageSize(Number(value));
    setCurrentPage(1);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';

    // received_date and expiration_date are bare MySQL DATEs (no time, no zone).
    // `new Date('2027-03-15')` parses that as UTC midnight, so rendering it in a
    // negative-offset timezone shows the PREVIOUS day (Mar 14 in the US). Build
    // the date from its parts instead so the calendar day is whatever was stored,
    // in every timezone.
    const bare = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    const d = bare
      ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
      : new Date(dateStr);

    if (isNaN(d.getTime())) return '-';

    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  };

  const formatCurrency = (val: number) =>
    `₱${Number(val ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const percentUsed = (batch: InventoryBatch) => {
    if (!batch.quantity_in || batch.quantity_in === 0) return 0;
    return Math.round(((batch.quantity_in - batch.quantity_remaining) / batch.quantity_in) * 100);
  };

  return {
    batches,
    isLoading,
    search,
    handleSearch,
    statusFilter,
    handleStatusFilter,
    currentPage,
    setCurrentPage,
    pageSize,
    handlePageSize,
    total,
    totalPages,
    loadBatches,
    formatDate,
    formatCurrency,
    percentUsed,
  };
}
