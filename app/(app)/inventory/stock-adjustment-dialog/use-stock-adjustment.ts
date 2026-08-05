'use client';

import { useEffect, useMemo, useState } from 'react';

import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { logActivity } from '@/lib/client-activity-logger';
import { useToast } from '@/hooks/use-toast';
import { toSafeNumber } from '@/lib/utils';
import type { Product } from '@/lib/types';

import { getProducts } from '../../products/actions';
import { adjustStock } from '../history/actions';

export interface UseStockAdjustmentProps {
  product: Product;
  defaultReason?: string;
  onSuccess?: () => void;
  requireConfirmation?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Controller for the stock adjustment / physical count dialog: owns the open +
 * confirmation state, the form fields, derived variance/projection, and the
 * adjust-stock submit flow.
 */
export function useStockAdjustment({
  product,
  defaultReason,
  onSuccess,
  requireConfirmation,
  open,
  onOpenChange,
}: UseStockAdjustmentProps) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = open !== undefined ? open : internalOpen;
  const setIsOpen = onOpenChange !== undefined ? onOpenChange : setInternalOpen;

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState(defaultReason || '');
  const [customReason, setCustomReason] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove'>('add');
  const [expirationDate, setExpirationDate] = useState('');

  const [physicalCount, setPhysicalCount] = useState<number | null>(null);

  const [childProducts, setChildProducts] = useState<Product[]>([]);
  const [isLoadingChildren, setIsLoadingChildren] = useState(false);

  const isPhysicalCountMode = defaultReason === 'Physical Count';

  // Expiry applies only when receiving new stock into a perishable product.
  // Removals deduct oldest-first via FIFO, and a physical count reconciles
  // stock that already exists — neither receives a new date.
  const showExpirationField =
    Boolean(product.isPerishable) && adjustmentType === 'add' && !isPhysicalCountMode;

  // Recording already-expired stock found during a count is legitimate, so this
  // warns without blocking.
  const isExpirationInPast = useMemo(() => {
    if (!expirationDate) return false;
    const today = new Date().toISOString().slice(0, 10);
    return expirationDate < today;
  }, [expirationDate]);

  const dialogTitle = isPhysicalCountMode ? `Physical Count` : `Adjust Stock`;

  // product.stock comes back from MySQL as a DECIMAL, which mysql2 returns as a
  // string — `+`/`-` against it silently does string concatenation instead of
  // arithmetic, so every consumer here works off a coerced number.
  const currentStock = toSafeNumber(product.stock);

  const variance = useMemo(() => {
    if (isPhysicalCountMode && physicalCount !== null) {
      return physicalCount - currentStock;
    }
    return 0;
  }, [isPhysicalCountMode, physicalCount, currentStock]);

  const projectedStock = useMemo(() => {
    const adj = adjustmentType === 'add' ? quantity : -quantity;
    return Math.max(0, currentStock + adj);
  }, [currentStock, quantity, adjustmentType]);

  const reasons = {
    add: ['New Shipment', 'Customer Return', 'Stock Correction', 'Found in Warehouse', 'Other'],
    remove: ['Damage', 'Expired', 'Lost/Theft', 'Internal Use', 'Stock Correction', 'Other']
  };

  const loadChildProducts = async () => {
    setIsLoadingChildren(true);
    try {
      const allProducts = await getProducts();
      const children = allProducts.filter((p: Product) => p.parentId === product.id);
      setChildProducts(children);
    } catch (error) {
      console.error('Failed to load child products:', error);
      setChildProducts([]);
    } finally {
      setIsLoadingChildren(false);
    }
  };

  // Load child products when dialog opens
  useEffect(() => {
    if (isOpen && !isPhysicalCountMode) {
      loadChildProducts();
    }
  }, [isOpen, isPhysicalCountMode]);

  useEffect(() => {
    if (isOpen) {
      setReason(defaultReason || '');
      setCustomReason('');
      setQuantity(0);
      setAdjustmentType('add');
      setPhysicalCount(Number(product.stock));
      setChildProducts([]);
      setExpirationDate('');
    }
  }, [isOpen, defaultReason, product.stock]);

  const handleQuantityChange = (value: string) => {
    const num = parseFloat(value);
    setQuantity(isNaN(num) || num < 0 ? 0 : num);
  };

  const handlePhysicalCountChange = (value: string) => {
    if (value === '') {
        setPhysicalCount(null);
        return;
    }
    const num = parseFloat(value);
    setPhysicalCount(isNaN(num) || num < 0 ? 0 : num);
  };

  const processAdjustment = async () => {
    let adjustment: number;
    let finalReason: string;

    if (isPhysicalCountMode) {
      if (physicalCount === null) {
        toast({
          variant: 'destructive',
          title: 'Missing Information',
          description: 'Please enter the physically counted quantity.',
        });
        return;
      }
      adjustment = variance;
      finalReason = 'Physical Count';
    } else {
      const effectiveReason = reason === 'Other' ? customReason : reason;
      if (!quantity || !effectiveReason) {
        toast({
          variant: 'destructive',
          title: 'Missing Information',
          description: 'Please enter a quantity and reason.',
        });
        return;
      }
      const signedQuantity = adjustmentType === 'add' ? quantity : -quantity;
      adjustment = signedQuantity;
      finalReason = effectiveReason;
    }

    const newStock = currentStock + adjustment;

    if (newStock < 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid Adjustment',
        description: "Stock can't go below zero.",
      });
      return;
    }

    if (adjustment === 0) {
        toast({
            title: 'No Change Needed',
            description: 'The stock level is already correct.',
        });
        setIsOpen(false);
        return;
    }

    try {
      const userSession = localStorage.getItem('mock-user-session');
      const userId = userSession ? JSON.parse(userSession).uid : 'system';
      const parentResult = await adjustStock(
        product.id,
        adjustment,
        finalReason,
        userId,
        false,
        showExpirationField && expirationDate ? expirationDate : null
      );
      const res = parentResult as any;

      if (!res.success) {
        toast({
          variant: 'destructive',
          title: 'Adjustment Failed',
          description: res.error || 'Failed to adjust stock.',
        });
        return;
      }

      const adjustLabel = adjustment > 0 ? `+${adjustment}` : String(adjustment);
      await logActivity({
        action: 'ADJUST',
        module: 'INVENTORY',
        description: `Stock adjusted: "${product.name}" ${adjustLabel} units — Reason: ${finalReason}${res.pendingApproval ? ' (pending approval)' : ''}`,
        referenceId: String(product.id),
      });
      if (res.pendingApproval) {
        toast({
          title: 'Adjustment Pending Approval',
          description: `Stock adjustment for ${product.name} has been submitted for multi-level approval.`,
        });
      } else {
        toast({
          title: 'Stock Adjusted',
          description: `Stock for ${product.name} has been updated to ${res.newStock}.`,
        });
      }
      setIsOpen(false);
      setIsConfirmOpen(false);
      onSuccess?.();
      dispatchStockUpdate();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Adjustment Failed',
        description: 'An error occurred while adjusting stock.',
      });
    }
  };

  const handleAdjustStock = () => {
    if (requireConfirmation) {
      setIsConfirmOpen(true);
    } else {
      processAdjustment();
    }
  };

  const adjustmentTypeLabel = adjustmentType === 'add' ? 'Addition' : 'Removal';
  const confirmationMessage = isPhysicalCountMode
    ? `Are you sure you want to update the stock for ${product.name} to ${physicalCount} ${product.unitOfMeasure}? This will record a variance of ${variance > 0 ? '+' : ''}${variance}.`
    : `Are you sure you want to record a ${adjustmentTypeLabel.toLowerCase()} of ${quantity} ${product.unitOfMeasure} for ${product.name}?`;

  return {
    isOpen,
    setIsOpen,
    isConfirmOpen,
    setIsConfirmOpen,
    quantity,
    reason,
    setReason,
    customReason,
    setCustomReason,
    adjustmentType,
    setAdjustmentType,
    physicalCount,
    setPhysicalCount,
    isPhysicalCountMode,
    dialogTitle,
    variance,
    projectedStock,
    expirationDate,
    setExpirationDate,
    showExpirationField,
    isExpirationInPast,
    reasons,
    handleQuantityChange,
    handlePhysicalCountChange,
    handleAdjustStock,
    processAdjustment,
    confirmationMessage,
  };
}
