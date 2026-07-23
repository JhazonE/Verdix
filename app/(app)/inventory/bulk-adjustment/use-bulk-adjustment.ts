'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { logActivity } from '@/lib/client-activity-logger';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { useToast } from '@/hooks/use-toast';
import type { Product, Supplier, Warehouse } from '@/lib/types';

import { getProducts } from '../../products/actions';
import type { AdjustmentItem, AdjustmentType } from './constants';

/**
 * Controller for the bulk stock adjustment screen: owns product/metadata
 * loading, the batch of pending adjustments, the per-item mutations, and the
 * submit flow. Keeps the screen and its sub-components presentational.
 */
export function useBulkAdjustment() {
  const router = useRouter();
  const { toast } = useToast();
  const searchRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState('');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('add');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>('');
  const [supplierId, setSupplierId] = useState<string>('');
  const [referenceNo, setReferenceNo] = useState('');
  const [note, setNote] = useState('');

  const [adjustments, setAdjustments] = useState<AdjustmentItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // The column only earns its width when it can actually be used: adding stock,
  // with at least one perishable product in the batch.
  const showExpirationColumn =
    adjustmentType === 'add' && adjustments.some(a => Boolean(a.product.isPerishable));

  // One delivery usually shares a single expiry, so let the user stamp them all
  // at once instead of typing the same date on every row.
  const applyExpirationToAll = (date: string) => {
    setAdjustments(prev =>
      prev.map(a => (a.product.isPerishable ? { ...a, expirationDate: date } : a))
    );
  };

  // Mobile: show config panel or list
  const [mobileView, setMobileView] = useState<'list' | 'config'>('list');
  // Mobile: show search overlay
  const [showMobileSearch, setShowMobileSearch] = useState(false);

  useEffect(() => {
    loadProducts();
    loadMetadata();
  }, []);

  // Close search results when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadProducts = async () => {
    setIsLoadingProducts(true);
    try {
      const data = await getProducts();
      // Services are excluded: they have no stock, so they can't be added,
      // removed, or transferred. getProducts() is shared with the general
      // inventory list, so filter here rather than in the action itself.
      setAllProducts(data.filter((p: Product) => p.type !== 'service'));
    } catch (error) {
      console.error('Failed to load products:', error);
    } finally {
      setIsLoadingProducts(false);
    }
  };

  const loadMetadata = async () => {
    try {
      const [whRes, supRes] = await Promise.all([
        fetch('/api/warehouses?activeOnly=true').then(r => r.json()),
        fetch('/api/suppliers').then(r => r.json())
      ]);
      if (whRes.success) setWarehouses(whRes.data);
      if (supRes.success) setSuppliers(supRes.data);
    } catch (error) {
      console.error('Failed to load metadata:', error);
    }
  };

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return [];
    let filtered = allProducts;
    if (warehouseId && warehouseId !== 'none') {
      filtered = filtered.filter(p => p.warehouseId === warehouseId || p.warehouse === warehouseId);
    }
    return filtered.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 40);
  }, [allProducts, search, warehouseId]);

  const addProduct = (product: Product) => {
    if (adjustments.some(a => a.product.id === product.id)) {
      toast({ title: 'Already added', description: `${product.name} is already in the list.` });
      return;
    }
    setAdjustments(prev => [...prev, { product, quantity: 1, type: adjustmentType, reason: '' }]);
    setSearch('');
    setShowResults(false);
    setShowMobileSearch(false);
  };

  const removeAdjustment = (productId: string) => {
    setAdjustments(prev => prev.filter(a => a.product.id !== productId));
  };

  const updateAdjustment = (productId: string, updates: Partial<AdjustmentItem>) => {
    setAdjustments(prev => prev.map(a => a.product.id === productId ? { ...a, ...updates } : a));
  };

  /** Switch the batch mode and re-stamp every existing item with the new type. */
  const changeAdjustmentType = (type: AdjustmentType) => {
    setAdjustmentType(type);
    setAdjustments(prev => prev.map(a => ({ ...a, type })));
  };

  const handleProcessAdjustments = async () => {
    if (adjustments.length === 0) return;
    if (adjustmentType === 'transfer' && !targetWarehouseId) {
      toast({ variant: 'destructive', title: 'Target Warehouse Required', description: 'Please select a destination warehouse.' });
      return;
    }
    setIsProcessing(true);
    try {
      const userSession = localStorage.getItem('mock-user-session');
      const userId = userSession ? JSON.parse(userSession).uid : 'system';
      const payload = {
        adjustments: adjustments.map(a => ({
          productId: a.product.id,
          quantity: a.quantity,
          reason: a.reason || note || 'Bulk Stock Adjustment',
          expirationDate: a.product.isPerishable && adjustmentType === 'add' ? (a.expirationDate || null) : null,
        })),
        notes: note || 'Bulk Stock Adjustment',
        userId, warehouseId, targetWarehouseId, referenceNo, supplierId, adjustmentType
      };
      const response = await fetch('/api/inventory/adjust/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (result.success) {
        await logActivity({
          action: 'ADJUST',
          module: 'INVENTORY',
          description: `Bulk stock adjustment: processed ${result.processed} item(s)`,
        });
        toast({ title: 'Bulk Adjustment Successful', description: `Processed ${result.processed} items.` });
        setAdjustments([]);
        dispatchStockUpdate();
        router.push('/inventory');
      } else {
        throw new Error(result.error || 'Failed to process adjustments');
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Adjustment Failed', description: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const hasNegativeStock = adjustments.some(a => {
    const newStock = a.type === 'remove' ? a.product.stock - a.quantity : a.product.stock + a.quantity;
    return newStock < 0;
  });

  const addCount = adjustments.filter(a => a.type === 'add').length;
  const removeCount = adjustments.filter(a => a.type === 'remove').length;
  const transferCount = adjustments.filter(a => a.type === 'transfer').length;

  return {
    router,
    searchRef,
    search,
    setSearch,
    isLoadingProducts,
    showResults,
    setShowResults,
    warehouses,
    suppliers,
    adjustmentType,
    changeAdjustmentType,
    warehouseId,
    setWarehouseId,
    targetWarehouseId,
    setTargetWarehouseId,
    supplierId,
    setSupplierId,
    referenceNo,
    setReferenceNo,
    note,
    setNote,
    adjustments,
    isProcessing,
    showExpirationColumn,
    applyExpirationToAll,
    mobileView,
    setMobileView,
    showMobileSearch,
    setShowMobileSearch,
    filteredProducts,
    addProduct,
    removeAdjustment,
    updateAdjustment,
    handleProcessAdjustments,
    hasNegativeStock,
    addCount,
    removeCount,
    transferCount,
  };
}
