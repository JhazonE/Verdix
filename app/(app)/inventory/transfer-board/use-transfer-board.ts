'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/client-activity-logger';
import { getApiUrl } from '@/lib/api-config';
import {
  buildProductQuery,
  matchesNormalizedSearch,
  normalizeSearchTerm,
  PRODUCT_SEARCH_DEBOUNCE_MS,
} from '@/lib/product-search';
import type { Warehouse } from '@/lib/types';

import type { StagedTransferItem, WarehouseStockItem } from './transfer-board-types';

export function useTransferBoard() {
  const { toast } = useToast();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Search refreshes are tracked separately from the initial load so they can
  // show a subtle indicator instead of unmounting the board (see fetchProducts).
  const [isSearching, setIsSearching] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Guards the one-time initial load, and discards out-of-order responses.
  const hasLoadedOnce = useRef(false);
  const latestProductRequest = useRef(0);

  const [sourceSearch, setSourceSearch] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>('');
  const [stagedItems, setStagedItems] = useState<StagedTransferItem[]>([]);
  const [isTransferring, setIsTransferring] = useState(false);
  const [user, setUser] = useState<{ uid: string; [key: string]: any } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('source');

  useEffect(() => {
    setMounted(true);
    // The search effect below performs the initial load (empty term), so
    // fetching here too would double every page open.
    const userSession = localStorage.getItem('mock-user-session');
    if (userSession) setUser(JSON.parse(userSession));
  }, []);

  // Warehouses don't change while someone types a product name, so they load
  // once rather than on every debounced search.
  const fetchWarehouses = async () => {
    try {
      const whRes = await fetch(getApiUrl('/warehouses?activeOnly=true'));
      const whData = await whRes.json();
      if (whData.success) setWarehouses(whData.data);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load warehouses.' });
    }
  };

  // Only the FIRST load may raise isLoading: TransferBoard.tsx early-returns a
  // full-screen spinner on it, which unmounts the board — and the search input
  // the user is typing into — causing a visible flicker on every keystroke.
  // Search refreshes use isSearching, which leaves the board mounted.
  const fetchProducts = async (search = '', { initial = false } = {}) => {
    if (initial) setIsLoading(true);
    else setIsSearching(true);
    // Ignore a response that arrives after a newer one: requests can complete
    // out of order, and a slow early keystroke must not overwrite the results
    // of the term the user has actually typed.
    const requestId = ++latestProductRequest.current;
    try {
      const prodRes = await fetch(getApiUrl(buildProductQuery(search)));
      const prodData = await prodRes.json();
      if (requestId !== latestProductRequest.current) return;
      if (prodData.success) setProducts(prodData.data);
    } catch (error) {
      if (requestId !== latestProductRequest.current) return;
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load board data.' });
    } finally {
      if (requestId === latestProductRequest.current) {
        if (initial) setIsLoading(false);
        else setIsSearching(false);
      }
    }
  };

  // Kept for callers that want a full refresh (post-transfer, warehouse edits).
  const fetchData = async (search = '') => {
    await Promise.all([fetchWarehouses(), fetchProducts(search)]);
  };

  // Re-query the server as the user types. The catalogue is far larger than
  // any sane preload (15,633 products at the time of writing), so matching
  // has to happen in SQL — the repository already matches name, SKU and
  // barcode. Debounced so a barcode scanner, which types a whole code in
  // milliseconds, fires one request rather than one per character.
  useEffect(() => {
    if (!mounted) return;
    // First pass loads warehouses and products together and owns the
    // full-screen spinner; later passes only re-query products.
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      fetchWarehouses();
      fetchProducts(sourceSearch, { initial: true });
      return;
    }
    const t = setTimeout(() => { fetchProducts(sourceSearch); }, PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [sourceSearch, mounted]);

  const allStockItems = useMemo<WarehouseStockItem[]>(() => {
    return products.map(p => {
      const whId = p.warehouseId || p.warehouse || 'unassigned';
      const whName = warehouses.find(w => w.id === whId)?.name || (whId === 'unassigned' ? 'Unassigned' : 'Unknown');
      return {
        uniqueId: `${whId}|${p.id}`,
        product: p,
        warehouseId: whId,
        warehouseName: whName,
        quantity: p.stock || 0,
      };
    });
  }, [products, warehouses]);

  const filteredSourceItems = useMemo(() => {
    // The server has already matched this term (name/SKU/barcode) across the
    // whole catalogue. Re-applying the same match locally only hides rows
    // still on screen from the previous term during the debounce window, so
    // the list never shows results that contradict what has been typed.
    const term = normalizeSearchTerm(sourceSearch);
    return allStockItems
      .filter(i => matchesNormalizedSearch(i.product, term) && i.quantity > 0)
      .sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [allStockItems, sourceSearch]);

  const toggleSelectItem = (uniqueId: string) => {
    const s = new Set(selectedSourceIds);
    if (s.has(uniqueId)) s.delete(uniqueId);
    else s.add(uniqueId);
    setSelectedSourceIds(s);
  };

  const toggleSelectAll = () => {
    if (selectedSourceIds.size === filteredSourceItems.length) {
      setSelectedSourceIds(new Set());
    } else {
      setSelectedSourceIds(new Set(filteredSourceItems.map(i => i.uniqueId)));
    }
  };

  const stageItems = (ids: Set<string> | string) => {
    const list = typeof ids === 'string' ? [ids] : Array.from(ids);
    const newStaged = [...stagedItems];
    let addedCount = 0;

    list.forEach(id => {
      const item = allStockItems.find(i => i.uniqueId === id);
      if (!item || newStaged.some(s => s.sourceUniqueId === item.uniqueId)) return;
      newStaged.push({
        stagedId: uuidv4(),
        sourceUniqueId: item.uniqueId,
        product: item.product,
        sourceWarehouseId: item.warehouseId,
        sourceWarehouseName: item.warehouseName,
        maxQuantity: Math.ceil(item.quantity),
        transferQuantity: Math.ceil(item.quantity),
      });
      addedCount++;
    });

    if (addedCount > 0) {
      setStagedItems(newStaged);
      if (typeof ids !== 'string') setSelectedSourceIds(new Set());
      toast({ title: 'Items Staged', description: `Added ${addedCount} item(s) to transfer list.` });
      setActiveTab('staging');
    }
  };

  const removeStagedItem = (stagedId: string) => {
    setStagedItems(prev => prev.filter(i => i.stagedId !== stagedId));
  };

  const updateStagedQuantity = (stagedId: string, value: string) => {
    const v = parseInt(value) || 1;
    setStagedItems(prev =>
      prev.map(i =>
        i.stagedId === stagedId
          ? { ...i, transferQuantity: Math.min(i.maxQuantity, Math.max(1, v)) }
          : i
      )
    );
  };

  const clearStaged = () => setStagedItems([]);

  const executeTransfer = async () => {
    if (!targetWarehouseId || stagedItems.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select a destination warehouse.' });
      return;
    }

    if (stagedItems.some(i => i.sourceWarehouseId === targetWarehouseId)) {
      toast({ variant: 'destructive', title: 'Invalid Transfer', description: 'Some items are already in the target warehouse.' });
      return;
    }

    setIsTransferring(true);
    try {
      const transfers = stagedItems.map(i => ({
        sourceProductId: i.product.id,
        targetWarehouseId: targetWarehouseId === 'unassigned' ? null : targetWarehouseId,
        quantity: i.transferQuantity,
        notes: 'Warehouse Board Transfer',
      }));

      const response = await fetch(getApiUrl('/inventory/transfer/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transfers, userId: user?.uid || 'system' }),
      });

      const result = await response.json();

      if (result.success) {
        await logActivity({
          action: 'TRANSFER',
          module: 'INVENTORY',
          description: `Warehouse board transfer: ${stagedItems.length} item(s) transferred${result.pendingApproval ? ' (pending approval)' : ''}`,
        });
        if (result.pendingApproval) {
          toast({ title: 'Approval Required', description: 'The transaction is sent to the approvals.' });
        } else {
          toast({ title: 'Success', description: 'Warehouse transfer completed successfully.' });
        }
        setTargetWarehouseId('');
        setActiveTab('source');
        setStagedItems([]);
        // Refresh within the user's current search, not the whole list —
        // dropping the term here would silently clear what they typed.
        fetchData(sourceSearch);
      } else {
        throw new Error(result.error || 'Transfer failed');
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to execute transfer.' });
    } finally {
      setIsTransferring(false);
    }
  };

  return {
    mounted,
    isLoading,
    isSearching,
    warehouses,
    fetchData,
    sourceSearch,
    setSourceSearch,
    selectedSourceIds,
    toggleSelectItem,
    toggleSelectAll,
    filteredSourceItems,
    stageItems,
    targetWarehouseId,
    setTargetWarehouseId,
    stagedItems,
    removeStagedItem,
    updateStagedQuantity,
    clearStaged,
    isTransferring,
    executeTransfer,
    activeTab,
    setActiveTab,
  };
}
