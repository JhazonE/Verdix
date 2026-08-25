'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

import { logActivity } from '@/lib/client-activity-logger';
import { useToast } from '@/hooks/use-toast';
import { toSafeNumber } from '@/lib/utils';
import { exportStockCountToPDF } from './pdf-export';

// A count can cover the whole store's catalog (thousands of items), so this
// screen's row-count options run much larger than the stock-counts list page's.
export const ITEM_PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

/**
 * Controller for the stock count detail screen: loads the count + its items,
 * owns the per-item count edits, the save/complete/print flows, and the derived
 * progress/variance summaries.
 */
export function useCountDetail({ countId }: { countId: string }) {
  const [count, setCount] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  // searchTerm is the raw input, updated on every keystroke. search is the applied
  // filter, only committed by handleSearch (Search button / Enter) — filtering runs
  // 3 substring checks per item over up to ~15k items, so re-filtering on every
  // keystroke made typing laggy. This also matches barcode-scanner input (scanner
  // types fast then sends Enter) better than a debounce delay would.
  const [searchTerm, setSearchTerm] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ITEM_PAGE_SIZE_OPTIONS[1]);

  const router = useRouter();
  const { toast } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchDetails = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/inventory/stock-counts/${countId}`);
      if (!res.ok) {
        const errText = await res.text();
        console.error('Error response body:', errText);
        throw new Error(`Failed to fetch count details (Status ${res.status})`);
      }
      const data = await res.json();
      if (data.success) {
        setCount(data.data);
        setItems(data.data.items || []);
      } else {
        throw new Error(data.error || 'Failed to fetch count details');
      }
    } catch (error) {
      console.error(error);
      toast({ title: 'Error loading count details', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [countId]);

  const handleSearch = () => setSearch(searchTerm);

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Stable identity (functional update, no deps) so the memoized row components below
  // don't get a "changed" onChange prop — and re-render — on every unrelated render
  // (e.g. a search keystroke).
  const handleQuantityChange = useCallback((id: string, value: string) => {
    const numValue = value === '' ? null : Number(value);
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, counted_quantity: numValue } : item))
    );
  }, []);

  // After entering a count, jump back to the search box so the next barcode scan
  // can go straight in. Stable identity for the same reason as handleQuantityChange.
  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const handleSaveProgress = async () => {
    try {
      setIsSaving(true);
      const payload = items
        .filter((item) => item.counted_quantity !== null)
        .map((item) => ({ id: item.id, counted_quantity: item.counted_quantity }));

      const res = await fetch(`/api/inventory/stock-counts/${countId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      });

      if (!res.ok) throw new Error('Failed to save progress');

      toast({ title: 'Progress saved successfully' });
      await fetchDetails();
    } catch (error) {
      console.error(error);
      toast({ title: 'Failed to save progress', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async () => {
    try {
      setIsCompleting(true);
      const payload = items
        .filter((item) => item.counted_quantity !== null)
        .map((item) => ({ id: item.id, counted_quantity: item.counted_quantity }));

      if (payload.length > 0) {
        await fetch(`/api/inventory/stock-counts/${countId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: payload }),
        });
      }

      const res = await fetch(`/api/inventory/stock-counts/${countId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedBy: 'Admin' }),
      });

      const result = await res.json();

      await logActivity({
        action: 'UPDATE',
        module: 'INVENTORY',
        description: `Completed stock count${result.pendingApproval ? ' (submitted for approval)' : ' — Inventory updated'}`,
        referenceId: countId,
      });
      if (result.pendingApproval) {
        toast({
          title: 'Stock count submitted for approval.',
          description: 'Inventory will be updated once approved.',
        });
      } else {
        toast({ title: 'Stock count completed! Inventory has been updated.' });
      }

      setShowReviewDialog(false);
      router.push('/inventory/stock-counts');
    } catch (error: any) {
      console.error(error);
      toast({ title: error.message || 'Error completing count', variant: 'destructive' });
    } finally {
      setIsCompleting(false);
    }
  };

  // The print table is only mounted while actively printing (see PrintLayout usage
  // in CountDetailClient) — with hundreds/thousands of items (a stock count usually
  // covers the whole store), keeping it permanently mounted made window.print() block
  // the main thread laying out a hidden multi-thousand-row table on every visit to
  // this page, not just when printing.
  //
  // A single requestAnimationFrame fires just before the next paint, not after it —
  // window.print() could still run before the browser has actually painted the newly
  // mounted print table, capturing a transient frame where it overlaps the on-screen
  // table (both visible at once). Nesting two rAFs defers to the frame *after* the
  // mount has painted, which is the standard "wait until painted" pattern.
  const handlePrint = () => {
    setIsPrinting(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  useEffect(() => {
    const handleAfterPrint = () => setIsPrinting(false);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  // Exports every item in the count (ignores search/pagination) to a paginated PDF.
  // jsPDF/autoTable lay out pages programmatically instead of depending on the
  // browser's print engine, so this is the safe path for printing "everything" on
  // a count that can span the whole store's catalog.
  const handleExportPDF = () => {
    setIsExporting(true);
    try {
      exportStockCountToPDF(count, items);
    } catch (error) {
      console.error(error);
      toast({ title: 'Failed to export PDF', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const lowerSearch = search.toLowerCase();
    return items.filter(
      (item) =>
        item.product_name?.toLowerCase().includes(lowerSearch) ||
        item.product_sku?.toLowerCase().includes(lowerSearch) ||
        item.product_barcode?.toLowerCase().includes(lowerSearch)
    );
  }, [items, search]);

  // Reset to page 1 whenever the visible set changes shape (new search, or a page-size
  // change stranded the current page past the new last page).
  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedItems = useMemo(
    () => filteredItems.slice((page - 1) * pageSize, page * pageSize),
    [filteredItems, page, pageSize]
  );

  const itemsWithVariances = useMemo(
    () =>
      items.filter(
        (item) => item.counted_quantity !== null && item.counted_quantity !== item.snapshot_quantity
      ),
    [items]
  );

  const uncountedItems = useMemo(
    () => items.filter((item) => item.counted_quantity === null),
    [items]
  );

  const countedCount = items.length - uncountedItems.length;
  const progressPct = items.length ? Math.round((countedCount / items.length) * 100) : 0;

  // Grand totals across counted items only (uncounted lines have no variance yet).
  // totalVariance = net qty over/short; totalVarianceAmount = net peso (variance × cost).
  const { totalVariance, totalVarianceAmount } = useMemo(() => {
    let qty = 0;
    let amount = 0;
    for (const item of items) {
      if (item.counted_quantity === null) continue;
      const v = item.counted_quantity - item.snapshot_quantity;
      qty += v;
      amount += v * toSafeNumber(item.product_cost);
    }
    return { totalVariance: qty, totalVarianceAmount: amount };
  }, [items]);

  // Print only ever covers the currently visible page — a count can span the whole
  // store's catalog (thousands of rows), and asking a browser/printer to paginate
  // all of it in one go is what produced the garbled/overlapping print preview.
  // Totals on the printed sheet are scoped to that same page so the footer matches
  // what's actually printed on it.
  const { printPageVariance, printPageVarianceAmount } = useMemo(() => {
    let qty = 0;
    let amount = 0;
    for (const item of paginatedItems) {
      if (item.counted_quantity === null) continue;
      const v = item.counted_quantity - item.snapshot_quantity;
      qty += v;
      amount += v * toSafeNumber(item.product_cost);
    }
    return { printPageVariance: qty, printPageVarianceAmount: amount };
  }, [paginatedItems]);

  return {
    count,
    items,
    search,
    searchTerm,
    setSearchTerm,
    handleSearch,
    handleSearchKeyDown,
    isSearchPending: searchTerm !== search,
    isLoading,
    isSaving,
    isCompleting,
    isPrinting,
    isExporting,
    showReviewDialog,
    setShowReviewDialog,
    router,
    searchInputRef,
    handleQuantityChange,
    handleFocusSearch,
    handleSaveProgress,
    handleComplete,
    handlePrint,
    handleExportPDF,
    filteredItems,
    paginatedItems,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    itemsWithVariances,
    uncountedItems,
    countedCount,
    progressPct,
    totalVariance,
    totalVarianceAmount,
    printPageVariance,
    printPageVarianceAmount,
  };
}
