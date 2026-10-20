'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useToast } from '@/hooks/use-toast';
import { useProducts, mapApiProduct } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useCustomerDisplay } from '@/hooks/use-customer-display';
import { useLiveRefresh, dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { calculateEffectivePriceForUnit, resolvePriceForLevel } from '@/lib/pricing';
import { resolveSellingUnitForAdd, baseSellingUnitOf, findCartLineForUnit, promoteToLargestUnit } from '@/lib/pos-cart-units';
import { resolveEffectiveTaxType } from '@/lib/tax-utils';
import { getApiUrl } from '@/lib/api-config';
import { formatStockQuantity } from '@/lib/utils';
import { WALK_IN_CUSTOMER } from '../customer-account/customer-account-types';
import { type SaleItem, type SuspendedTransaction, type QueuedOrder, mapVatStatusToTaxType } from './pos-types';
import type { Customer, SystemSettings } from '@/lib/types';

// Carts persisted or queued by a pre-lineId version of this app (localStorage
// pos_current_cart, a held/suspended transaction, a queued order claimed from
// the server) can contain SaleItems with no lineId. Every selection/void/edit
// call site keys off lineId, so backfill one before such an array ever enters
// items state — otherwise every line in that cart shares lineId: undefined and
// voiding one wipes them all.
const withLineIds = (list: SaleItem[]): SaleItem[] =>
  (list || []).map(item => (item.lineId ? item : { ...item, lineId: crypto.randomUUID() }));

export function usePOS() {
  const [currentShiftId, setCurrentShiftId] = useState<string | null>(null);
  const [showEndShiftReport, setShowEndShiftReport] = useState(false);
  const [returnToEndShiftReport, setReturnToEndShiftReport] = useState(false);
  const [isOverallReadingOpen, setIsOverallReadingOpen] = useState(false);
  const [isXReadingOpen, setIsXReadingOpen] = useState(false);
  const [lastEndedShiftId, setLastEndedShiftId] = useState<string | null>(null);
  const [isPriceInquiryOpen, setIsPriceInquiryOpen] = useState(false);

  const [terminals, setTerminals] = useState<any[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>('');
  const [isEndingShift, setIsEndingShift] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    const posTheme = localStorage.getItem('pos-theme');
    if (posTheme) setTheme(posTheme);
    return () => {
      const adminTheme = localStorage.getItem('admin-theme');
      if (adminTheme) setTheme(adminTheme);
    };
  }, []);

  const { toast } = useToast();
  const router = useRouter();

  const [currentTime, setCurrentTime] = useState('');
  const [items, setItems] = useState<SaleItem[]>([]);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const currentTerminal = useMemo(
    () => terminals.find(t => t.id === selectedTerminalId) || null,
    [terminals, selectedTerminalId]
  );
  const inventoryLocation = currentTerminal?.inventoryLocation || '';

  const { products: fetchedProducts, loading: productsLoading, refetch: refreshProducts } = useProducts('', 'Available', undefined, inventoryLocation);
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    if (!productsLoading && fetchedProducts) setProducts(fetchedProducts);
  }, [fetchedProducts, productsLoading]);

  const stableRefresh = useCallback(() => { refreshProducts(); }, [refreshProducts]);
  useLiveRefresh(stableRefresh);

  // The locally-cached `products` above is capped (server returns only the
  // first page) — with a large catalog most products live outside that page,
  // so the search box queries the server directly, same as the F9 dialog does.
  const debouncedSearchQuery = useDebounce(inputValue, 250);
  const { products: serverSearchResults, loading: searchLoading } = useProducts(
    debouncedSearchQuery.trim(),
    'Available',
    undefined,
    inventoryLocation
  );

  const [isTenderDialogOpen, setIsTenderDialogOpen] = useState(false);
  const [tenderMethod, setTenderMethod] = useState<string | null>(null);
  const [heldTransactions, setHeldTransactions] = useState<SuspendedTransaction[]>([]);
  const [isSuspendNoteOpen, setIsSuspendNoteOpen] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [startingCash, setStartingCash] = useState(0);
  const [cashSales, setCashSales] = useState(0);
  const [otherPaymentMethods, setOtherPaymentMethods] = useState<{ name: string; amount: number }[]>([]);
  const [membershipCash, setMembershipCash] = useState(0);
  const [isPosLoggedIn, setIsPosLoggedIn] = useState(false);
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(WALK_IN_CUSTOMER);
  const [isLoyaltyOpen, setIsLoyaltyOpen] = useState(false);
  const [isRecentSalesOpen, setIsRecentSalesOpen] = useState(false);
  const [isVoidSalesOpen, setIsVoidSalesOpen] = useState(false);
  const [isReturnSalesOpen, setIsReturnSalesOpen] = useState(false);
  const [isZReadingOpen, setIsZReadingOpen] = useState(false);
  const [isZReadingWarningOpen, setIsZReadingWarningOpen] = useState(false);
  const [isShutdownConfirmOpen, setIsShutdownConfirmOpen] = useState(false);

  const [businessSettings, setBusinessSettings] = useState<SystemSettings | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [priceLevels, setPriceLevels] = useState<any[]>([]);

  const isFrontliner = useMemo(
    () => !!(currentUser?.permissions as string[] | undefined)?.includes('pos_frontliner'),
    [currentUser]
  );

  const [queuedOrders, setQueuedOrders] = useState<QueuedOrder[]>([]);
  // Set when a frontliner recalls one of their own queued orders back to the cart to edit it;
  // resending reuses this same customer-facing number instead of drawing a new one. Cleared
  // whenever the cart empties out (sent back, or voided out line by line) so the number
  // never leaks onto an unrelated later order.
  const [editingQueueOrder, setEditingQueueOrder] = useState<{ dailyQueueNumber: number } | null>(null);
  useEffect(() => {
    if (items.length === 0 && editingQueueOrder) setEditingQueueOrder(null);
  }, [items.length, editingQueueOrder]);
  const [isQueuePanelOpen, setIsQueuePanelOpen] = useState(false);
  const [isSendToQueueOpen, setIsSendToQueueOpen] = useState(false);
  const [isFrontlinerPromptOpen, setIsFrontlinerPromptOpen] = useState(false);
  const [isFrontlinerBlocked, setIsFrontlinerBlocked] = useState(false);
  const [selectedPriceLevelId, setSelectedPriceLevelId] = useState<string>('');

  const [enableNegativeInventory, setEnableNegativeInventory] = useState(false);
  const [enableCashCountAuth, setEnableCashCountAuth] = useState(false);
  const [cashCountAuthCredentials, setCashCountAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isCashCountAuthOpen, setIsCashCountAuthOpen] = useState(false);
  const [enableLineVoidAuth, setEnableLineVoidAuth] = useState(false);
  const [lineVoidAuthCredentials, setLineVoidAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isLineVoidAuthOpen, setIsLineVoidAuthOpen] = useState(false);
  const [priceEditAuthCredentials, setPriceEditAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isPriceEditAuthOpen, setIsPriceEditAuthOpen] = useState(false);
  const [discountAuthCredentials, setDiscountAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isDiscountAuthOpen, setIsDiscountAuthOpen] = useState(false);
  const [editItemAuthCredentials, setEditItemAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isEditItemAuthOpen, setIsEditItemAuthOpen] = useState(false);
  const [editQtyAuthCredentials, setEditQtyAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isEditQtyAuthOpen, setIsEditQtyAuthOpen] = useState(false);
  const [pendingQtyDelta, setPendingQtyDelta] = useState<number | null>(null);
  const [suspendAuthCredentials, setSuspendAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isSuspendAuthOpen, setIsSuspendAuthOpen] = useState(false);
  const [suspendedAuthCredentials, setSuspendedAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isSuspendedAuthOpen, setIsSuspendedAuthOpen] = useState(false);
  const [isOverallReadingAuthOpen, setIsOverallReadingAuthOpen] = useState(false);
  const [overallReadingAuthCredentials, setOverallReadingAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [xReadingAuthCredentials, setXReadingAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [zReadingAuthCredentials, setZReadingAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isTrainingMode, setIsTrainingMode] = useState(false);

  const [isInsufficientStockOpen, setIsInsufficientStockOpen] = useState(false);
  const [insufficientItems, setInsufficientItems] = useState<SaleItem[]>([]);

  const [enableCustomerDisplay, setEnableCustomerDisplay] = useState(false);
  const { send: cdSend, openOnSecondScreen } = useCustomerDisplay(enableCustomerDisplay);

  useEffect(() => {
    if (!resolvedTheme) return;
    cdSend({ type: 'THEME', theme: resolvedTheme as 'light' | 'dark' });
  }, [resolvedTheme, cdSend]);

  const [isHeldTransOpen, setIsHeldTransOpen] = useState(false);
  const [isEndShiftOpen, setIsEndShiftOpen] = useState(false);
  const [isCashTransferOpen, setIsCashTransferOpen] = useState(false);
  const [isCashTransferPreAuthOpen, setIsCashTransferPreAuthOpen] = useState(false);
  const [isDiscountDialogOpen, setIsDiscountDialogOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editingNameItemId, setEditingNameItemId] = useState<string | null>(null);
  const [editingQtyItemId, setEditingQtyItemId] = useState<string | null>(null);
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [pendingVoidItemId, setPendingVoidItemId] = useState<string | null>(null);
  const [pendingVoidScope, setPendingVoidScope] = useState<'selected' | 'all'>('selected');
  const [isVoidLineChoiceOpen, setIsVoidLineChoiceOpen] = useState(false);
  const [qtyDraft, setQtyDraft] = useState('');
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [isCollisionOpen, setIsCollisionOpen] = useState(false);
  const [collisionShift, setCollisionShift] = useState<any>(null);
  const [isCheckingShift, setIsCheckingShift] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; isActive: boolean; isReferenceRequired?: boolean; pointsAmount?: number; currencyEquivalent?: number }[]>([]);
  const [showQuantityInSearch, setShowQuantityInSearch] = useState(true);
  // Defaults OFF, matching the column default: the picker changes what a
  // cashier can do at the till, so a store opts in rather than finding a new
  // control after an update.
  const [enablePriceLevelPicker, setEnablePriceLevelPicker] = useState(false);

  // Sticky focus on main input when all dialogs close
  useEffect(() => {
    const isAnyDialogOpen =
      isTenderDialogOpen || isDiscountDialogOpen || isHeldTransOpen || isLineVoidAuthOpen ||
      isVoidLineChoiceOpen ||
      isEndShiftOpen || isCashTransferOpen || isCustomerSelectOpen || isLoyaltyOpen ||
      isRecentSalesOpen || isVoidSalesOpen || isReturnSalesOpen || isPriceInquiryOpen ||
      isZReadingOpen || isShutdownConfirmOpen || isInsufficientStockOpen || isProductSearchOpen ||
      showEndShiftReport || isEndingShift;

    if (!isAnyDialogOpen && isPosLoggedIn && shiftActive) {
      const timer = setTimeout(() => { inputRef.current?.focus(); }, 100);
      return () => clearTimeout(timer);
    }
  }, [
    isTenderDialogOpen, isDiscountDialogOpen, isHeldTransOpen, isLineVoidAuthOpen,
    isVoidLineChoiceOpen,
    isEndShiftOpen, isCashTransferOpen, isCustomerSelectOpen, isLoyaltyOpen,
    isRecentSalesOpen, isVoidSalesOpen, isReturnSalesOpen, isPriceInquiryOpen,
    isZReadingOpen, isShutdownConfirmOpen, isInsufficientStockOpen, isProductSearchOpen,
    showEndShiftReport, isPosLoggedIn, shiftActive,
  ]);

  // Restore session on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('pos_current_user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        // A kiosk account must not be restored into checkout either — a
        // session stored before this guard existed would otherwise walk
        // straight back in on reload.
        if (parsedUser?.userType === 'Price Inquiry') {
          localStorage.removeItem('pos_current_user');
          router.replace('/price-check');
          return;
        }
        setCurrentUser(parsedUser);
        setIsPosLoggedIn(true);
      } catch {}
    }

    const storedShiftId = localStorage.getItem('pos_current_shift_id');
    if (storedShiftId) {
      fetch(getApiUrl(`/pos/shifts?shiftId=${storedShiftId}`))
        .then(res => res.json())
        .then(result => {
          if (result.success && result.data.status === 'active') {
            setCurrentShiftId(storedShiftId);
            const uid = JSON.parse(storedUser || '{}').id || JSON.parse(storedUser || '{}').uid;
            setShiftActive(result.data.userId === uid);
          } else {
            localStorage.removeItem('pos_current_shift_id');
            setShiftActive(false);
            setCurrentShiftId(null);
          }
        })
        .catch(() => { setShiftActive(false); });
    }
  }, []);

  const selectedItem = useMemo(() => items.find(item => item.lineId === selectedItemId) || null, [items, selectedItemId]);

  // Scroll to selected item
  useEffect(() => {
    if (selectedItemId) {
      document.getElementById(`pos-item-${selectedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedItemId]);

  // Sync qty draft and cancel inline edits on row change
  useEffect(() => {
    setQtyDraft(selectedItem ? String(baseQtyOf(selectedItem)) : '');
    const keepIfCurrent = (prev: string | null) => (prev && prev !== selectedItemId ? null : prev);
    setEditingNameItemId(keepIfCurrent);
    setEditingQtyItemId(keepIfCurrent);
    setEditingPriceItemId(keepIfCurrent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId, selectedItem?.quantity]);

  const focusInlineField = (prefix: string, itemId: string) => {
    const tryFocus = () => {
      const el = document.getElementById(`${prefix}-${itemId}`) as HTMLInputElement | null;
      if (el) { el.focus(); el.select(); }
    };
    setTimeout(tryFocus, 0);
    setTimeout(tryFocus, 130);
  };

  const unlockInlineName = (itemId: string) => {
    setSelectedItemId(itemId);
    setEditingNameItemId(itemId);
    setEditingQtyItemId(null);
    setEditingPriceItemId(null);
    focusInlineField('pos-name', itemId);
  };

  const startEditName = (itemId: string) => {
    setSelectedItemId(itemId);
    if (businessSettings?.enableEditItemAuth) setIsEditItemAuthOpen(true);
    else unlockInlineName(itemId);
  };

  const commitInlineName = (itemId: string, rawValue: string) => {
    const item = items.find(i => i.lineId === itemId);
    if (item) {
      const newName = rawValue.trim();
      if (newName && newName !== item.name) handleUpdateItem(itemId, newName, item.quantity, item.price, item.discount);
    }
    setEditingNameItemId(null);
  };

  // The inline qty box counts BASE units (pieces), whatever unit the line is in.
  const baseQtyOf = (item: any) => Number((item.quantity * (item.selectedSellingUnit?.factor || 1)).toFixed(4));

  const commitQty = (itemId: string) => {
    setEditingQtyItemId(null);
    const item = items.find(i => i.lineId === itemId);
    if (!item) return;
    const q = parseFloat(qtyDraft);
    if (isNaN(q) || q <= 0) { setQtyDraft(String(baseQtyOf(item))); return; }
    if (q !== baseQtyOf(item)) updateQuantity(itemId, q, true);
  };

  const requestInlinePriceEdit = (itemId: string) => {
    setSelectedItemId(itemId);
    if (businessSettings?.enablePriceEditAuth) setIsPriceEditAuthOpen(true);
    else unlockInlinePrice(itemId);
  };

  const fetchSettings = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(getApiUrl('/pos-settings'), { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setEnableNegativeInventory(result.data.enableNegativeInventory);
        setEnableCashCountAuth(result.data.enableCashCountAuth);
        setCashCountAuthCredentials({ username: result.data.cashCountAuthUsername, password: result.data.cashCountAuthPassword });
        setEnableLineVoidAuth(result.data.enableLineVoidAuth);
        setLineVoidAuthCredentials({ username: result.data.lineVoidAuthUsername, password: result.data.lineVoidAuthPassword });
        setPriceEditAuthCredentials({ username: result.data.priceEditAuthUsername, password: result.data.priceEditAuthPassword });
        setDiscountAuthCredentials({ username: result.data.discountAuthUsername, password: result.data.discountAuthPassword });
        setEditItemAuthCredentials({ username: result.data.editItemAuthUsername, password: result.data.editItemAuthPassword });
        setEditQtyAuthCredentials({ username: result.data.editQtyAuthUsername, password: result.data.editQtyAuthPassword });
        setSuspendAuthCredentials({ username: result.data.suspendAuthUsername, password: result.data.suspendAuthPassword });
        setSuspendedAuthCredentials({ username: result.data.suspendedAuthUsername, password: result.data.suspendedAuthPassword });
        setOverallReadingAuthCredentials({ username: result.data.overallReadingAuthUsername, password: result.data.overallReadingAuthPassword });
        setXReadingAuthCredentials({ username: result.data.xReadingAuthUsername, password: result.data.xReadingAuthPassword });
        setZReadingAuthCredentials({ username: result.data.zReadingAuthUsername, password: result.data.zReadingAuthPassword });
        setIsTrainingMode(result.data.isTrainingMode || false);
        setShowQuantityInSearch(result.data.showQuantityInSearch ?? true);
        setEnablePriceLevelPicker(result.data.enablePriceLevelPicker ?? false);
        setEnableCustomerDisplay(result.data.enableCustomerDisplay || false);

        const localPrintMode = localStorage.getItem('pos_printer_mode');
        const localPrinterName = localStorage.getItem('pos_printer_name');
        const localPaperSize = localStorage.getItem('pos_paper_size');
        const localTwoReceipts = localStorage.getItem('pos_print_two_receipts');
        setBusinessSettings({
          ...result.data,
          ...(localPrintMode ? { printMode: localPrintMode } : {}),
          ...(localPrinterName ? { nativePrinterName: localPrinterName } : {}),
          ...(localPaperSize ? { paperSize: localPaperSize } : {}),
          ...(localTwoReceipts !== null ? { printTwoReceipts: localTwoReceipts === 'true' } : {}),
        });
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSettings(controller.signal);

    const handleSettingsChange = (e: StorageEvent) => {
      if (e.key === 'pos_settings_version') fetchSettings(controller.signal);
    };
    window.addEventListener('storage', handleSettingsChange);
    const pollInterval = setInterval(() => fetchSettings(controller.signal), 30000);

    return () => {
      controller.abort();
      window.removeEventListener('storage', handleSettingsChange);
      clearInterval(pollInterval);
    };
  }, [fetchSettings]);

  // Queue polling — cashiers need an active shift; frontliners poll as soon as logged in
  // (they never run shifts) so they can see their own queued orders.
  useEffect(() => {
    if (!isPosLoggedIn) return;
    if (!isFrontliner && !shiftActive) return;
    const fetchQueue = () => {
      fetch(getApiUrl('/pos/queue'))
        .then(r => r.json())
        .then(result => { if (result.success) setQueuedOrders(result.data); })
        .catch(() => {});
    };
    fetchQueue();
    const interval = setInterval(fetchQueue, 8000);
    return () => clearInterval(interval);
  }, [isPosLoggedIn, shiftActive, isFrontliner]);

  useEffect(() => {
    if (enableCustomerDisplay && isPosLoggedIn) openOnSecondScreen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableCustomerDisplay, isPosLoggedIn]);

  useEffect(() => {
    if (!enableCustomerDisplay) return;
    if (items.length === 0) { cdSend({ type: 'IDLE' }); return; }
    const gross = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
    const total = items.reduce((acc, item) => {
      const lineGross = item.price * item.quantity;
      return acc + (lineGross - (lineGross * item.discount) / 100);
    }, 0);
    cdSend({
      type: 'CART_UPDATE', items, subtotal: gross, discount: gross - total, total,
      currency: businessSettings?.currencySymbol || '₱',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, enableCustomerDisplay]);

  // Fetch initial data
  useEffect(() => {
    const fetchPriceLevels = async () => {
      try {
        const levels = await import('../../products/actions').then(m => m.getPriceLevels());
        setPriceLevels(levels);
        const defaultLevel = levels.find((l: any) => l.isDefault);
        if (defaultLevel) setSelectedPriceLevelId(defaultLevel.id);
      } catch {}
    };
    fetchPriceLevels();

    const fetchTerminals = async () => {
      try {
        const response = await fetch(getApiUrl('/pos-terminals?activeOnly=true'));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.success) {
          const terminalsData = result.data;
          setTerminals(terminalsData);
          const clientIp = result.clientIp;
          const autoMatch = terminalsData.find((t: any) => t.ipAddress === clientIp);
          const storedId = localStorage.getItem('pos_terminal_id');
          const storedTerminal = terminalsData.find((t: any) => t.id === storedId);

          if (autoMatch) {
            setSelectedTerminalId(autoMatch.id);
            localStorage.setItem('pos_terminal_id', autoMatch.id);
            toast({ title: 'Terminal Connected', description: `Automatically connected to ${autoMatch.terminalDescription} (${clientIp})` });
          } else if (storedTerminal) {
            setSelectedTerminalId(storedTerminal.id);
            toast({ title: 'Manual Terminal Connected', description: `Connected to ${storedTerminal.terminalDescription} (Note: This machine IP is ${clientIp})` });
          } else {
            toast({ variant: 'destructive', title: 'Terminal Not Found', description: `No terminal configured for IP: ${clientIp}. Please register this IP in Terminals page.` });
            if (terminalsData.length > 0) {
              setSelectedTerminalId(terminalsData[0].id);
              localStorage.setItem('pos_terminal_id', terminalsData[0].id);
            }
          }
        }
      } catch {}
    };
    fetchTerminals();

    const fetchPaymentMethods = async () => {
      try {
        const response = await fetch(getApiUrl('/payment-methods?activeOnly=true'));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.success && result.data) setPaymentMethods(result.data);
      } catch {}
    };
    fetchPaymentMethods();
  }, []);

  // Terminal heartbeat
  useEffect(() => {
    if (!selectedTerminalId) return;
    const sendHeartbeat = () => {
      fetch(getApiUrl('/pos-terminals'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedTerminalId }),
      }).catch(console.error);
    };
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 60000);
    return () => clearInterval(interval);
  }, [selectedTerminalId]);

  const currentTerminalName = useMemo(() => {
    const t = terminals.find(t => t.id === selectedTerminalId);
    return t ? (t.terminalDescription || `Terminal ${t.id.slice(-4)}`) : '';
  }, [terminals, selectedTerminalId]);

  // Clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const isPosLoggedInRef = useRef(isPosLoggedIn);
  useEffect(() => { isPosLoggedInRef.current = isPosLoggedIn; }, [isPosLoggedIn]);

  const shiftActiveRef = useRef(shiftActive);
  const isCheckingShiftRef = useRef(isCheckingShift);
  const isPosLoggedInSyncRef = useRef(isPosLoggedIn);
  useEffect(() => {
    shiftActiveRef.current = shiftActive;
    isCheckingShiftRef.current = isCheckingShift;
    isPosLoggedInSyncRef.current = isPosLoggedIn;
  }, [shiftActive, isCheckingShift, isPosLoggedIn]);

  // Persist cart
  useEffect(() => {
    if (!isPosLoggedInSyncRef.current) return;
    if (isCheckingShiftRef.current) return;
    if (items.length > 0 || selectedCustomer?.id !== 'walk-in' || heldTransactions.length > 0) {
      localStorage.setItem('pos_current_cart', JSON.stringify({ items, selectedCustomer, heldTransactions }));
    } else if (shiftActiveRef.current) {
      localStorage.removeItem('pos_current_cart');
    }
  }, [items, selectedCustomer, heldTransactions]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPosLoggedInRef.current) return;
      const activeElement = document.activeElement;
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' || activeElement?.hasAttribute('cmdk-input');
      const isMainInput = activeElement === inputRef.current;
      if (isInput && !isMainInput) return;
      // Also matches an open Radix Select listbox (the selling-unit picker),
      // not just Dialog/AlertDialog/Sheet — a cashier mid-selection there
      // should not have F-keys or arrow keys act on the cart underneath.
      const isDialogOpen = document.querySelector('[role="dialog"],[role="listbox"]') !== null;
      // Blanket bailout: none of the F-key shortcuts below should fire while
      // a dialog or the unit-picker listbox is open.
      if (isDialogOpen) return;

      switch (e.key) {
        case 'F1': handleOpenEditDialog(); break;
        case 'F2': e.preventDefault(); handleVoidLine(selectedItemId); break;
        case 'F3': handleOpenDiscountDialog(); break;
        case 'F4': handleHold(); break;
        case 'F5': handleOpenSuspended(); break;
        case 'F6': e.preventDefault(); focusInlineQuantity(selectedItemId); break;
        case 'F7': e.preventDefault(); handleRequestPriceEdit(); break;
        case 'F8': setIsShutdownConfirmOpen(true); break;
        case '+': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (selectedItemId && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            requestQuantityDelta(selectedItemId, 1);
          }
          break;
        }
        case '-': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (selectedItemId && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const item = items.find(i => i.lineId === selectedItemId);
            if (item && item.quantity > 1) requestQuantityDelta(selectedItemId, -1);
          }
          break;
        }
        case 'ArrowUp': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (items.length > 0 && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const idx = items.findIndex(i => i.lineId === selectedItemId);
            setSelectedItemId(items[idx <= 0 ? items.length - 1 : idx - 1].lineId);
          }
          break;
        }
        case 'ArrowDown': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (items.length > 0 && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const idx = items.findIndex(i => i.lineId === selectedItemId);
            setSelectedItemId(items[idx >= items.length - 1 ? 0 : idx + 1].lineId);
          }
          break;
        }
        case 'F9': e.preventDefault(); setIsProductSearchOpen(prev => !prev); break;
        case 'q': case 'Q': {
          if (e.ctrlKey && !isFrontliner && businessSettings?.posMode === 'pharmacy') {
            e.preventDefault();
            setIsQueuePanelOpen(true);
          }
          break;
        }
        case 'F10': handleOpenTender('CREDIT_CARD'); break;
        case 'F11': handleOpenTender('E_WALLET'); break;
        case 'F12': handleOpenTender('POINTS'); break;
      }

      if (e.ctrlKey) {
        switch (e.key) {
          case '1': e.preventDefault(); handleOpenEndShift(); break;
          case '2': e.preventDefault(); handleOpenCashTransfer(); break;
          case '3': e.preventDefault(); setIsCustomerSelectOpen(true); break;
          case '4': e.preventDefault(); handleOpenLoyalty(); break;
          case '5': e.preventDefault(); setIsRecentSalesOpen(true); break;
          case '6': e.preventDefault(); setIsVoidSalesOpen(true); break;
          case '7': e.preventDefault(); setIsReturnSalesOpen(true); break;
          case 'p': case 'P': e.preventDefault(); setIsPriceInquiryOpen(true); break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, selectedItemId, heldTransactions, enableLineVoidAuth, isFrontliner, businessSettings?.posMode]);

  const defaultLevelId = useMemo(() => priceLevels.find((l: any) => l.isDefault)?.id || 'retail-level', [priceLevels]);
  const activeLevelId = useMemo(() => selectedCustomer?.priceLevelId || selectedPriceLevelId || defaultLevelId, [selectedCustomer, selectedPriceLevelId, defaultLevelId]);
  const activeLevelName = useMemo(() => priceLevels.find((l: any) => l.id === activeLevelId)?.name || 'Retail', [activeLevelId, priceLevels]);

  /**
   * The price for ONE cart line. Every re-pricing site in this hook goes
   * through here and calls neither resolver directly.
   *
   * That single entry point is the point: a line carrying a picked level must
   * keep it when the quantity changes, when the item is re-scanned, and when
   * the cart-wide level moves. Those are separate code paths, and a fix
   * applied to only some of them produces a price that silently reverts —
   * intermittently, at the till, which is the worst failure this feature can
   * have. Routing them all through one helper makes a partial fix impossible
   * rather than merely unlikely.
   *
   * With a pick, tiers are ignored and the level's own price wins (it may be
   * higher than the shelf price — a deliberate instruction is allowed to raise
   * a line). Without one, this is exactly today's behaviour.
   */
  /**
   * The display name of a line's picked level, or undefined when there is no
   * pick or the level has since been deleted.
   *
   * A deleted level must NOT clear `pickedPriceLevelId`. The id is the record
   * of why the line is priced as it is, and the price already degrades safely
   * to the unit's own price (see resolvePriceForLevel). Clearing it would
   * silently re-price the line and lose that reason — so the badge simply
   * renders nothing and the line stays as the cashier set it.
   */
  const priceLevelNameFor = useCallback(
    (pickedPriceLevelId?: string): string | undefined =>
      pickedPriceLevelId
        ? priceLevels.find((l: any) => l.id === pickedPriceLevelId)?.name
        : undefined,
    [priceLevels],
  );

  const priceLineFor = useCallback((
    unit: Parameters<typeof calculateEffectivePriceForUnit>[0],
    quantity: number,
    pickedPriceLevelId?: string,
  ): number => {
    if (pickedPriceLevelId) return resolvePriceForLevel(unit, pickedPriceLevelId);
    return calculateEffectivePriceForUnit(unit, quantity, activeLevelId, defaultLevelId);
  }, [activeLevelId, defaultLevelId]);

  // Re-price items when price level changes
  useEffect(() => {
    if (!activeLevelId) return;
    setItems(currentItems => {
      if (currentItems.length === 0) return currentItems;
      // A line with a picked level resolves to the same price here, so the
      // `changed` guard below leaves it untouched — the cart-wide level moving
      // must not drag a deliberately priced line with it.
      const updated = currentItems.map(item => ({ ...item, price: priceLineFor(item.selectedSellingUnit ?? baseSellingUnitOf(item), item.quantity, item.pickedPriceLevelId) }));
      const changed = JSON.stringify(currentItems.map(i => i.price)) !== JSON.stringify(updated.map(i => i.price));
      return changed ? updated : currentItems;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevelId]);

  // Handlers
  const handleAddItem = (product: any | undefined, matchedCode?: string, explicitUnitId?: string) => {
    if (product) {
      const unit = product.type === 'service'
        ? undefined
        : explicitUnitId
          ? product.sellingUnits?.find((u: any) => u.id === explicitUnitId) ?? resolveSellingUnitForAdd(product, matchedCode)
          : resolveSellingUnitForAdd(product, matchedCode);
      const existing = product.type === 'service'
        ? items.find(item => item.id === product.id)
        : findCartLineForUnit(items, product.id, unit?.id);
      // Adding an existing line (quantity bump) never changes the cart's
      // document type, so only check on a genuinely new line.
      if (!existing && items.length > 0) {
        const cartType = items[0].type === 'service' ? 'service' : 'standard';
        const newItemType = product.type === 'service' ? 'service' : 'standard';
        if (cartType !== newItemType) {
          toast({
            title: 'Cannot Mix Goods and Services',
            description: 'This sale already has a ' + (cartType === 'service' ? 'service' : 'goods') + ' item. Please complete this as two separate transactions.',
            variant: 'destructive',
          });
          setInputValue('');
          setTimeout(() => inputRef.current?.focus(), 0);
          return;
        }
      }
      setItems(prevItems => {
        const existingLine = product.type === 'service'
          ? prevItems.find(item => item.id === product.id)
          : findCartLineForUnit(prevItems, product.id, unit?.id);
        if (existingLine) {
          const newQty = existingLine.quantity + 1;
          const priceUnit = unit ?? baseSellingUnitOf(product);
          // Re-scanning a line the cashier priced by level must not undo that
          // pick — the line keeps its level and its price.
          const newPrice = priceLineFor(priceUnit, newQty, existingLine.pickedPriceLevelId);
          return prevItems.map(item => item === existingLine ? { ...item, quantity: newQty, price: newPrice } : item);
        } else {
          const priceUnit = unit ?? baseSellingUnitOf(product);
          const newItem: SaleItem = {
            ...product, quantity: 1, discount: 0, name: product.name,
            selectedSellingUnit: unit,
            lineId: crypto.randomUUID(),
            // A brand-new line carries no pick and follows the cart.
            price: priceLineFor(priceUnit, 1, undefined),
            taxType: mapVatStatusToTaxType(product.vatStatus),
          };
          setSelectedItemId(newItem.lineId);
          return [...prevItems, newItem];
        }
      });
    } else {
      toast({ title: 'Error', description: 'Product not found', variant: 'destructive' });
    }
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const rankMatches = (list: any[], q: string, limit: number): any[] => {
    const exactCode: any[] = [];
    const exactName: any[] = [];
    const partial: any[] = [];
    const seen = new Set<string>();
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const barcode = (p.barcode || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const baseUnitBarcode = ((p.sellingUnits || []).find((u: any) => u.isBase)?.barcode || '').toLowerCase();
      const unitBarcodeMatch = (p.sellingUnits || []).some((u: any) => !u.isBase && (u.barcode || '').toLowerCase() === q);
      if (baseUnitBarcode === q || barcode === q || unitBarcodeMatch) exactCode.push(p);
      else if (name === q) exactName.push(p);
      // Fuzzy/partial matching stays product-name/barcode only (base unit's
      // own barcode included) — matching partial text against every EXTRA
      // unit's barcode too would surface confusing unit-level partial hits
      // for what should read as a product-name search.
      else if (baseUnitBarcode.includes(q) || barcode.includes(q) || name.includes(q)) partial.push(p);
    }
    return [...exactCode, ...exactName, ...partial];
  };

  // Expands each ranked product into one suggestion row per selling unit, so
  // a product with a Pack alongside its base Piece shows as two pickable
  // rows instead of one ambiguous row that always adds the base unit.
  // Services carry no sellingUnits, so they always render as a single row.
  const expandToUnitSuggestions = (rankedProducts: any[], limit: number) => {
    const rows: any[] = [];
    for (const product of rankedProducts) {
      const units = product.type === 'service' ? [] : (product.sellingUnits || []);
      if (units.length > 1) {
        for (const unit of units) {
          rows.push({ product, unit, key: `${product.id}:${unit.id}` });
          if (rows.length >= limit) return rows;
        }
      } else {
        rows.push({ product, unit: units[0], key: product.id });
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  };

  // The catalog is larger than the locally-cached page, so suggestions rank
  // matches from the debounced server search (comprehensive) — falling back
  // to the local cache only while that server call is in flight.
  const getSearchSuggestions = useCallback((query: string, limit = 8): any[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const source = debouncedSearchQuery.trim().toLowerCase() === q && !searchLoading
      ? serverSearchResults
      : products;
    return expandToUnitSuggestions(rankMatches(source || [], q, limit), limit);
  }, [products, serverSearchResults, searchLoading, debouncedSearchQuery]);

  // Scanners submit a barcode/SKU that exactly matches one product. Check the
  // instant local cache first (covers the common case with zero lag), then
  // the debounced server results so products outside the cached page still
  // auto-add once their search response lands.
  const matchesProductOrUnitCode = (p: any, q: string) =>
    ((p.sellingUnits || []).find((u: any) => u.isBase)?.barcode || '').toLowerCase() === q ||
    (p.barcode || '').toLowerCase() === q ||
    (p.sellingUnits || []).some((u: any) => !u.isBase && (u.barcode || '').toLowerCase() === q);

  const findExactCodeMatch = useCallback((query: string): any | undefined => {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const inLocal = (products || []).find(p => matchesProductOrUnitCode(p, q));
    if (inLocal) return inLocal;
    if (debouncedSearchQuery.trim().toLowerCase() === q) {
      return (serverSearchResults || []).find(p => matchesProductOrUnitCode(p, q));
    }
    return undefined;
  }, [products, serverSearchResults, debouncedSearchQuery]);

  // A scanner's Enter can arrive before the 250ms debounce resolves the
  // server search, so findExactCodeMatch/getSearchSuggestions may still only
  // see the local cache page. Before reporting "not found", fire one direct
  // (undebounced) lookup for the exact code so products outside that page
  // still scan correctly.
  const handleAddItemBySKU = async (sku: string) => {
    if (!sku) return;
    const exactProduct = findExactCodeMatch(sku);
    if (exactProduct) { handleAddItem(exactProduct, sku); return; }
    const suggestion = getSearchSuggestions(sku, 1)[0];
    if (suggestion) { handleAddItem(suggestion.product, sku, suggestion.unit?.id); return; }

    const q = sku.trim();
    try {
      const response = await fetch(getApiUrl(`/products?search=${encodeURIComponent(q)}&limit=100`), { cache: 'no-store' });
      const result = await response.json();
      if (result.success) {
        const qLower = q.toLowerCase();
        const remote = (result.data || []).find((p: any) => matchesProductOrUnitCode(p, qLower));
        if (remote) { handleAddItem(mapApiProduct(remote), sku); return; }
      }
    } catch {
      // Network/API failure — fall through to the "not found" toast below.
    }
    handleAddItem(undefined);
  };

  const updateQuantity = (lineId: string, newQuantity: number, quantityIsBase = false) => {
    if (newQuantity <= 0) {
      removeItem(lineId);
    } else {
      setItems(prevItems => {
        const target = prevItems.find(item => item.lineId === lineId);
        if (!target) return prevItems;
        const currentUnit = quantityIsBase ? baseSellingUnitOf(target) : (target.selectedSellingUnit ?? baseSellingUnitOf(target));
        const { unit, quantity } = target.type === 'service'
          ? { unit: currentUnit, quantity: newQuantity }
          : promoteToLargestUnit(newQuantity, currentUnit, target.sellingUnits);
        // Changing the quantity must never undo a picked level. This is the
        // headline case: a price that snaps back to Retail when the cashier
        // types a quantity is a wrong-price bug at the till.
        const price = priceLineFor(unit, quantity, target.pickedPriceLevelId);
        const promoted = unit.id !== target.selectedSellingUnit?.id;
        // A promoted line may land on a unit the cart already carries; fold
        // the two together rather than showing duplicate lines.
        const sibling = promoted ? findCartLineForUnit(prevItems.filter(i => i.lineId !== lineId), target.id, unit.id) : undefined;
        if (sibling) {
          const mergedQty = sibling.quantity + quantity;
          // Two lines folding into one may carry different picks. The line
          // being promoted is the one the cashier just acted on, so its pick
          // wins; the sibling's stands only when the promoted line has none.
          // Dropping both would silently re-price a deliberately priced line
          // the moment a promotion happened to merge it.
          const mergedPick = target.pickedPriceLevelId ?? sibling.pickedPriceLevelId;
          const mergedPrice = priceLineFor(unit, mergedQty, mergedPick);
          return prevItems
            .filter(i => i.lineId !== lineId)
            .map(i => i === sibling ? { ...i, quantity: mergedQty, price: mergedPrice, pickedPriceLevelId: mergedPick } : i);
        }
        return prevItems.map(item => item === target
          ? { ...item, quantity, price, selectedSellingUnit: unit }
          : item);
      });
    }
  };

  const handleUpdateItem = (itemId: string, newName: string, newQty: number, newPrice: number, newDiscount: number) => {
    setItems(prev => prev.map(item => item.lineId === itemId ? { ...item, name: newName, quantity: newQty, price: newPrice, discount: newDiscount } : item));
  };

  const handleVoidLine = (itemId: string | null) => {
    if (items.length === 0) { toast({ title: 'Empty Cart', description: 'There are no items to void.', variant: 'destructive' }); return; }
    if (!itemId) { toast({ title: 'No Item Selected', description: 'Please select an item to void.', variant: 'destructive' }); return; }
    setPendingVoidItemId(itemId);
    setIsVoidLineChoiceOpen(true);
  };

  const handleVoidLineChoice = (scope: 'selected' | 'all') => {
    setIsVoidLineChoiceOpen(false);
    setPendingVoidScope(scope);
    if (enableLineVoidAuth) setIsLineVoidAuthOpen(true);
    else performVoidLine(pendingVoidItemId, scope);
  };

  const performVoidLine = (itemId: string | null, scope: 'selected' | 'all' = pendingVoidScope) => {
    if (scope === 'all') {
      const count = items.length;
      setItems([]);
      setSelectedItemId(null);
      setPendingVoidItemId(null);
      toast({ title: 'All Items Voided', description: `Removed ${count} ${count === 1 ? 'item' : 'items'} from the cart.` });
      return;
    }
    if (!itemId) return;
    const item = items.find(i => i.lineId === itemId);
    if (!item) return;
    removeItem(itemId);
    if (selectedItemId === itemId) setSelectedItemId(null);
    setPendingVoidItemId(null);
    toast({ title: 'Line Voided', description: `Removed ${item.name} from the cart.` });
  };

  const unlockInlineQty = (itemId: string) => {
    setSelectedItemId(itemId);
    setEditingQtyItemId(itemId);
    const lineToEdit = items.find(i => i.lineId === itemId);
    if (lineToEdit) setQtyDraft(String(baseQtyOf(lineToEdit)));
    setEditingNameItemId(null);
    setEditingPriceItemId(null);
    focusInlineField('pos-qty', itemId);
  };

  const focusInlineQuantity = (itemId: string | null) => {
    if (!itemId) { toast({ title: 'No Item Selected', description: 'Please select an item to adjust quantity.', variant: 'destructive' }); return; }
    setSelectedItemId(itemId);
    if (businessSettings?.enableEditQtyAuth) { setPendingQtyDelta(null); setIsEditQtyAuthOpen(true); }
    else unlockInlineQty(itemId);
  };

  // +/- always step one BASE unit, expressed in the line's own unit; a Pack
  // line stepped down becomes fractional and updateQuantity demotes it to pieces.
  const stepLineQuantity = (item: any, delta: number) =>
    item.quantity + delta / (item.selectedSellingUnit?.factor || 1);

  const requestQuantityDelta = (itemId: string, delta: number) => {
    if (businessSettings?.enableEditQtyAuth) {
      setSelectedItemId(itemId);
      setPendingQtyDelta(delta);
      setIsEditQtyAuthOpen(true);
    } else {
      const item = items.find(i => i.lineId === itemId);
      if (item) updateQuantity(itemId, stepLineQuantity(item, delta));
    }
  };

  const handleEditQtyAuthSuccess = () => {
    setIsEditQtyAuthOpen(false);
    if (!selectedItemId) return;
    if (pendingQtyDelta !== null) {
      const item = items.find(i => i.lineId === selectedItemId);
      if (item) updateQuantity(selectedItemId, stepLineQuantity(item, pendingQtyDelta));
      setPendingQtyDelta(null);
    } else {
      unlockInlineQty(selectedItemId);
    }
  };

  const removeItem = (lineId: string) => {
    setItems(items.filter(item => item.lineId !== lineId));
  };

  const handleSendToQueue = () => {
    if (items.length === 0) {
      toast({ title: 'Empty Cart', description: 'Add items before sending to queue.', variant: 'destructive' });
      return;
    }
    setIsSendToQueueOpen(true);
  };

  const handleConfirmSendToQueue = async (customerName: string, queueNotes: string) => {
    const userId = currentUser?.uid || currentUser?.id;
    const userName = currentUser?.displayName || currentUser?.username || 'Frontliner';
    try {
      const response = await fetch(getApiUrl('/pos/queue'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          customerId: selectedCustomer?.id === 'walk-in' ? undefined : selectedCustomer?.id,
          customerName: customerName || selectedCustomer?.name || 'Walk-in',
          queueNotes,
          fronlinerId: userId,
          frontlinerName: userName,
          terminalId: selectedTerminalId,
          terminalName: currentTerminalName,
          shiftId: currentShiftId,
          keepDailyQueueNumber: editingQueueOrder?.dailyQueueNumber,
        }),
      });
      const result = await response.json();
      if (result.success) {
        setItems([]);
        setSelectedItemId(null);
        setSelectedCustomer(WALK_IN_CUSTOMER);
        setEditingQueueOrder(null);
        return result.data as { queueNumber: number; dailyQueueNumber: number };
      } else throw new Error(result.error);
    } catch (error: any) {
      toast({ title: 'Queue Error', description: error.message || 'Failed to send order.', variant: 'destructive' });
      return null;
    }
  };

  const handleClaimQueuedOrder = async (orderId: string) => {
    if (items.length > 0) {
      toast({ title: 'Cart Not Empty', description: 'Clear the current cart before loading a queued order.', variant: 'destructive' });
      return;
    }
    try {
      const response = await fetch(getApiUrl(`/pos/queue?id=${orderId}`), { method: 'DELETE' });
      const result = await response.json();
      if (result.success) {
        setItems(withLineIds(result.data.items));
        setQueuedOrders(prev => prev.filter(o => o.id !== orderId));
        setIsQueuePanelOpen(false);
        toast({ title: `Order #${result.data.queueNumber} Loaded`, description: `From ${result.data.frontlinerName || 'frontliner'}.` });
      } else throw new Error(result.error);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to claim order.', variant: 'destructive' });
    }
  };

  // Frontliner pulls their own queued order back into the cart to edit and re-send it.
  const handleRecallQueuedOrder = async (orderId: string) => {
    if (items.length > 0) {
      toast({ title: 'Cart Not Empty', description: 'Clear the current cart before loading a queued order.', variant: 'destructive' });
      return;
    }
    const requesterId = currentUser?.uid || currentUser?.id;
    try {
      const response = await fetch(
        getApiUrl(`/pos/queue?id=${orderId}&action=recall&requesterId=${requesterId}`),
        { method: 'DELETE' }
      );
      const result = await response.json();
      if (result.success) {
        setItems(withLineIds(result.data.items));
        setQueuedOrders(prev => prev.filter(o => o.id !== orderId));
        setEditingQueueOrder({ dailyQueueNumber: result.data.dailyQueueNumber });
        setIsQueuePanelOpen(false);
        toast({
          title: `Order #${String(result.data.dailyQueueNumber).padStart(3, '0')} Loaded to Cart`,
          description: 'Edit and send back to queue — it will keep the same number.',
        });
      } else throw new Error(result.error);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to recall order.', variant: 'destructive' });
    }
  };

  const handleSuccessfulSale = (paymentMethod: string, amount: number) => {
    if (paymentMethod.toUpperCase() === 'CASH') setCashSales(prev => prev + amount);
    setItems([]);
    setSelectedCustomer(WALK_IN_CUSTOMER);
    dispatchStockUpdate();
  };

  const handleOpenTender = (method: string) => {
    if (isFrontliner) return;
    if (items.length > 0) {
      if (!enableNegativeInventory) {
        const lowStock = items.filter(item => {
          if (item.type === 'service') return false;
          const factor = item.selectedSellingUnit?.factor ?? 1;
          return item.quantity * factor > item.stock;
        });
        if (lowStock.length > 0) { setInsufficientItems(lowStock); setIsInsufficientStockOpen(true); return; }
      }
      setTenderMethod(method);
      setIsTenderDialogOpen(true);
      if (enableCustomerDisplay) {
        cdSend({ type: 'PAYMENT_START', total: totalDue, tendered: totalDue, currency: businessSettings?.currencySymbol || '₱' });
      }
    }
  };

  const handleDefaultTender = () => {
    const cashMethod = paymentMethods.find(m => m.name.toUpperCase() === 'CASH');
    handleOpenTender(cashMethod ? cashMethod.name : (paymentMethods.length > 0 ? paymentMethods[0].name : 'CASH'));
  };

  const handleOpenEditDialog = () => {
    if (selectedItem) startEditName(selectedItem.lineId);
    else toast({ title: 'No Item Selected', description: 'Please select an item to edit.', variant: 'destructive' });
  };

  const handleOpenDiscountDialog = () => {
    if (!selectedItem) {
      toast({ title: 'No Item Selected', description: 'Please select an item to apply a discount.', variant: 'destructive' });
      return;
    }
    // The no-item guard stays FIRST: prompting for credentials and then
    // refusing to open the sheet would make the cashier authorise nothing.
    if (businessSettings?.enableDiscountAuth) setIsDiscountAuthOpen(true);
    else setIsDiscountDialogOpen(true);
  };

  const handleDiscountAuthSuccess = () => {
    setIsDiscountAuthOpen(false);
    setIsDiscountDialogOpen(true);
  };

  const handleApplyDiscount = (itemId: string | 'ALL', percentage: number, discountType?: string, discountDetails?: { idNumber?: string; holderName?: string }) => {
    const discountIdNumber = discountDetails?.idNumber;
    const discountHolderName = discountDetails?.holderName;
    if (itemId === 'ALL') {
      const next = items.map(item => ({ ...item, discount: percentage, discountType, discountIdNumber, discountHolderName }));
      setItems(next);
      // A fixed amount was entered in pesos, so report it back in pesos — the
      // percentage it was spread into is an implementation detail.
      const describe = discountType === 'amount'
        ? `Applied ₱${next.reduce((acc, i) => acc + (i.price * i.quantity * percentage) / 100, 0).toFixed(2)} discount across all items.`
        : `Applied ${percentage.toFixed(2)}% discount to all items.`;
      toast({ title: 'Global Discount Applied', description: describe });
    } else {
      const target = items.find(item => item.lineId === itemId);
      setItems(items.map(item => item.lineId === itemId ? { ...item, discount: percentage, discountType, discountIdNumber, discountHolderName } : item));
      const describe = discountType === 'amount' && target
        ? `Discount updated to ₱${((target.price * target.quantity * percentage) / 100).toFixed(2)}`
        : `Discount updated to ${percentage.toFixed(2)}%`;
      toast({ title: 'Discount Applied', description: describe });
    }
  };

  const handleHold = () => {
    if (items.length === 0) {
      toast({ title: 'Empty Cart', description: 'There are no items to hold.', variant: 'destructive' });
      return;
    }
    if (businessSettings?.enableSuspendAuth) setIsSuspendAuthOpen(true);
    else setIsSuspendNoteOpen(true);
  };

  const handleSuspendAuthSuccess = () => {
    setIsSuspendAuthOpen(false);
    setIsSuspendNoteOpen(true);
  };

  const handleOpenSuspended = () => {
    if (businessSettings?.enableSuspendedAuth) setIsSuspendedAuthOpen(true);
    else setIsHeldTransOpen(true);
  };

  const handleSuspendedAuthSuccess = () => {
    setIsSuspendedAuthOpen(false);
    setIsHeldTransOpen(true);
  };

  const confirmHold = (note: string) => {
    setHeldTransactions(prev => [...prev, { id: Date.now().toString(), items: [...items], note: note || 'No Note', timestamp: new Date().toISOString() }]);
    setItems([]);
    setSelectedItemId(null);
    setSelectedCustomer(WALK_IN_CUSTOMER);
    setIsSuspendNoteOpen(false);
  };

  const handleRestore = (index: number) => {
    if (items.length > 0) { toast({ title: 'Cart Not Empty', description: 'Please clear the current cart before restoring a transaction.', variant: 'destructive' }); return; }
    setItems(withLineIds(heldTransactions[index].items));
    setHeldTransactions(prev => prev.filter((_, i) => i !== index));
    setIsHeldTransOpen(false);
  };

  const handleDeleteHeld = (index: number) => {
    setHeldTransactions(prev => prev.filter((_, i) => i !== index));
  };

  const handleStartShift = async (cash: number, explicitUserId?: string) => {
    const userId = explicitUserId || (currentUser?.uid || currentUser?.id);
    if (!userId) { toast({ title: 'Error', description: 'User not identified for shift start', variant: 'destructive' }); return; }
    try {
      if (!selectedTerminalId) { toast({ title: 'Error', description: 'No POS Terminal selected. Please configure a terminal.', variant: 'destructive' }); return; }
      const response = await fetch(getApiUrl('/pos/shifts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, terminalId: selectedTerminalId, startingCash: cash }),
      });
      const result = await response.json();
      if (result.success) {
        setStartingCash(cash);
        setCashSales(0);
        setMembershipCash(0);
        setShiftActive(true);
        setCurrentShiftId(result.data.shiftId);
        localStorage.setItem('pos_current_shift_id', result.data.shiftId);
        toast({ title: 'Shift Started', description: 'You are now ready to make sales.' });
      } else throw new Error(result.error || `HTTP ${response.status}`);
    } catch (error: any) {
      const isBusinessDayClosed = error.message?.includes('business day is still closed');
      toast({
        title: isBusinessDayClosed ? 'Business Day Closed' : 'Error',
        description: isBusinessDayClosed ? error.message : 'Failed to start shift: ' + error.message,
        variant: 'destructive',
      });
    }
  };

  const [cashDeposits, setCashDeposits] = useState(0);
  const [cashPickups, setCashPickups] = useState(0);

  const fetchShiftData = async () => {
    if (!currentShiftId) return;
    try {
      const response = await fetch(getApiUrl(`/pos/shifts?shiftId=${currentShiftId}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.success && result.data) {
        setStartingCash(result.data.startingCash);
        setCashSales(result.data.cashSales);
        setOtherPaymentMethods(result.data.otherPaymentMethods ?? []);
        setMembershipCash(result.data.membershipCash ?? 0);
        setCashDeposits(result.data.cashDeposits);
        setCashPickups(result.data.cashPickups);
      }
    } catch {}
  };

  const handleConfirmEndShift = async (data: { actualCash: number; cashDifference: number; notes: string; cashDenominations: any[] }) => {
    if (!currentShiftId || isEndingShift) return;
    setIsEndingShift(true);
    try {
      const response = await fetch(getApiUrl('/pos/shifts'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: currentShiftId, actualCash: data.actualCash, cashDifference: data.cashDifference, cashDenominations: data.cashDenominations, notes: data.notes }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();

      if (result.success) {
        setLastEndedShiftId(currentShiftId);
        localStorage.removeItem('pos_current_shift_id');
        localStorage.removeItem('pos_current_user');
        setCurrentShiftId(null);
        setIsEndShiftOpen(false);
        setShiftActive(false);
        setIsPosLoggedIn(false);
        setItems([]);
        setHeldTransactions([]);
        setSelectedCustomer(WALK_IN_CUSTOMER);
        setShowEndShiftReport(true);

        try {
          const xReadingRes = await fetch(getApiUrl(`/sales/x-reading?shiftId=${currentShiftId}&limit=1`));
          if (!xReadingRes.ok) throw new Error(`HTTP ${xReadingRes.status}`);
          const xReadingResult = await xReadingRes.json();
          if (xReadingResult.success && xReadingResult.data.length > 0) {
            const xData = xReadingResult.data[0];
            const timestampSuffix = new Date().toISOString().replace(/\D/g, '').slice(-6);
            const readingNo = `X-${(xData.id || currentShiftId).substring(0, 10).toUpperCase()}-${timestampSuffix}`;
            await fetch(getApiUrl('/sales/x-reading'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ readingNumber: readingNo, reportDate: xData.reportDate, shiftStart: xData.shiftStart, shiftEnd: xData.shiftEnd, terminalId: xData.terminalId, cashierName: xData.cashierName, cashierId: xData.cashierId, grossSales: xData.grossSales, returns: xData.returns, discounts: xData.discounts, netSales: xData.netSales, vatAmount: xData.vatAmount, paymentMethods: xData.paymentMethods, transactionCount: xData.transactionCount, startingCash: xData.startingCash, cashSales: xData.cashSales, cashInDrawer: xData.cashInDrawer, shiftStatus: 'completed' }),
            });
          }
        } catch {}

        toast({ title: 'Shift Ended', description: 'Shift closed and X-Reading saved.' });
      } else throw new Error(result.error);
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to end shift: ' + error.message, variant: 'destructive' });
    } finally {
      setIsEndingShift(false);
    }
  };

  const handlePosLoginSuccess = async (user: any) => {
    // A Price Inquiry account is the unattended price-checker kiosk: it must
    // never reach checkout. POS has its OWN login, separate from the main one
    // and from the app-layout pin, so without this check the kiosk account can
    // sign in here and ring up a real sale. Rejected BEFORE any logged-in
    // state is set, so the checkout screen never paints.
    if (user?.userType === 'Price Inquiry') {
      toast({
        variant: 'destructive',
        title: 'Price Inquiry account',
        description: 'This account can only use the price checker, not the register.',
      });
      router.replace('/price-check');
      return;
    }

    const userIsFrontliner = !!(user?.permissions as string[] | undefined)?.includes('pos_frontliner');

    // Block frontliner when POS is not in pharmacy mode
    if (userIsFrontliner && businessSettings?.posMode !== 'pharmacy') {
      setCurrentUser(user);
      setIsFrontlinerBlocked(true);
      setIsFrontlinerPromptOpen(true);
      return;
    }

    setIsCheckingShift(true);
    setIsPosLoggedIn(true);
    setCurrentUser(user);

    // Frontliner skips shift — mark active immediately
    if (userIsFrontliner) {
      setShiftActive(true);
      setIsFrontlinerBlocked(false);
      setIsFrontlinerPromptOpen(true);
      setIsCheckingShift(false);
      return;
    }

    localStorage.setItem('pos_current_user', JSON.stringify(user));

    const savedCart = localStorage.getItem('pos_current_cart');
    if (savedCart) {
      try {
        const parsed = JSON.parse(savedCart);
        setItems(withLineIds(parsed.items || []));
        setSelectedCustomer(parsed.selectedCustomer || WALK_IN_CUSTOMER);
        setHeldTransactions(parsed.heldTransactions || []);
      } catch {}
    }

    const loginUserId = user.id || user.uid;
    const terminalId = selectedTerminalId;
    if (terminalId) {
      try {
        const activeRes = await fetch(getApiUrl(`/pos/shifts?terminalId=${terminalId}&status=active`));
        if (!activeRes.ok) throw new Error(`HTTP ${activeRes.status}`);
        const activeResult = await activeRes.json();
        if (activeResult.success && activeResult.data) {
          const shift = activeResult.data;
          if (String(shift.user_id || shift.userId) !== String(loginUserId)) {
            setCollisionShift(shift);
            setIsCollisionOpen(true);
          } else {
            setCurrentShiftId(shift.id);
            setShiftActive(true);
            localStorage.setItem('pos_current_shift_id', shift.id);
          }
        } else {
          setShiftActive(false);
          setCurrentShiftId(null);
        }
      } catch {} finally {
        setIsCheckingShift(false);
      }
    } else {
      setIsCheckingShift(false);
    }
  };

  const handleContinueShift = async () => {
    if (!collisionShift || !currentUser) return;
    const userId = currentUser.id || currentUser.uid;
    try {
      const response = await fetch(getApiUrl('/pos/shifts'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: collisionShift.id, takeoverUserId: userId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setCurrentShiftId(collisionShift.id);
        setShiftActive(true);
        localStorage.setItem('pos_current_shift_id', collisionShift.id);
        setIsCollisionOpen(false);
        toast({ title: 'Shift Taken Over', description: `You have continued the session from ${collisionShift.cashierName || 'previous cashier'}.` });
      } else throw new Error(result.error);
    } catch (error: any) {
      const isBusinessDayClosed = error.message?.includes('business day is still closed');
      toast({
        title: isBusinessDayClosed ? 'Business Day Closed' : 'Takeover Failed',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleTakeoverStartNew = () => {
    if (!collisionShift) return;
    setIsCollisionOpen(false);
    setItems([]);
    setSelectedCustomer(WALK_IN_CUSTOMER);
    setHeldTransactions([]);
    setCurrentShiftId(collisionShift.id);
    setIsEndShiftOpen(true);
  };

  const handleLogout = () => {
    setIsPosLoggedIn(false);
    setCurrentUser(null);
    setShiftActive(false);
    setCurrentShiftId(null);
    localStorage.removeItem('pos_current_user');
    localStorage.removeItem('pos_current_shift_id');
  };

  const handleShutdown = () => handleLogout();

  const handleRequestPriceEdit = () => {
    if (selectedItem) {
      if (businessSettings?.enablePriceEditAuth) setIsPriceEditAuthOpen(true);
      else unlockInlinePrice(selectedItem.lineId);
    } else {
      toast({ title: 'No Item Selected', description: 'Please select an item to authorize price change.', variant: 'destructive' });
    }
  };

  const unlockInlinePrice = (itemId: string) => {
    setSelectedItemId(itemId);
    setEditingPriceItemId(itemId);
    setEditingNameItemId(null);
    setEditingQtyItemId(null);
    focusInlineField('pos-price', itemId);
  };

  const commitInlinePrice = (itemId: string, rawValue: string) => {
    const item = items.find(i => i.lineId === itemId);
    if (item) {
      const newPrice = parseFloat(rawValue);
      if (!isNaN(newPrice) && newPrice >= 0 && newPrice !== item.price) handleUpdateItem(itemId, item.name, item.quantity, newPrice, item.discount);
    }
    setEditingPriceItemId(null);
  };

  const handlePriceEditAuthSuccess = () => {
    setIsPriceEditAuthOpen(false);
    if (selectedItemId) unlockInlinePrice(selectedItemId);
  };

  const handleEditItemAuthSuccess = () => {
    setIsEditItemAuthOpen(false);
    if (selectedItemId) unlockInlineName(selectedItemId);
  };

  const handleSelectCustomer = (customer: Customer | null) => {
    setSelectedCustomer(customer);
    setIsCustomerSelectOpen(false);
  };

  const handleOpenLoyalty = () => setIsLoyaltyOpen(true);

  const handleOpenEndShift = async () => {
    if (currentShiftId) await fetchShiftData();
    if (enableCashCountAuth) setIsCashCountAuthOpen(true);
    else setIsEndShiftOpen(true);
  };

  const handleOpenOverallReading = () => {
    if (businessSettings?.enableOverallReadingAuth) setIsOverallReadingAuthOpen(true);
    else setIsOverallReadingOpen(true);
  };

  const handleOpenXReading = () => {
    setIsXReadingOpen(true);
  };

  const handleOpenZReadingWarning = () => {
    if (businessSettings?.requireZReadingConfirmation === false) setIsZReadingOpen(true);
    else setIsZReadingWarningOpen(true);
  };

  // AlertDialogAction (Continue) closes the warning AlertDialog itself before
  // onConfirm runs, same as AlertDialogCancel does for Cancel/Escape/outside-
  // click - Radix gives no way to tell which caused onOpenChange(false). This
  // ref lets zReadingWarningOpenChange distinguish "proceeding to Z-Reading"
  // from "cashier backed out", so only the latter reopens the picker.
  const zReadingWarningConfirmedRef = useRef(false);

  const handleConfirmZReadingWarning = () => {
    zReadingWarningConfirmedRef.current = true;
    setIsZReadingWarningOpen(false);
    // Deferred: opening the Z-Reading Sheet in the same tick as closing this
    // AlertDialog races Radix's shared scroll-lock/focus-trap singleton
    // (both are built on @radix-ui/react-dialog) - the outgoing Root hasn't
    // released it yet, so the incoming Sheet can mount unable to receive
    // pointer events. Letting this AlertDialog's close commit first avoids it.
    setTimeout(() => setIsZReadingOpen(true), 0);
  };

  const zReadingWarningOpenChange = (open: boolean) => {
    setIsZReadingWarningOpen(open);
    if (!open && !zReadingWarningConfirmedRef.current && returnToEndShiftReport) {
      setReturnToEndShiftReport(false);
      setShowEndShiftReport(true);
    }
    zReadingWarningConfirmedRef.current = false;
  };

  // Opened from the End Shift Report's 3-button picker: closing (back/X) on
  // the reading dialog should return to that picker instead of just closing,
  // since the cashier likely wants to check another one of the 3 reports.
  const handleOpenOverallReadingFromEndShiftReport = () => {
    setShowEndShiftReport(false);
    setReturnToEndShiftReport(true);
    handleOpenOverallReading();
  };

  const handleOpenXReadingFromEndShiftReport = () => {
    setShowEndShiftReport(false);
    setReturnToEndShiftReport(true);
    handleOpenXReading();
  };

  const handleOpenZReadingWarningFromEndShiftReport = () => {
    setShowEndShiftReport(false);
    setReturnToEndShiftReport(true);
    handleOpenZReadingWarning();
  };

  // Shared onOpenChange for the Overall/X/Z reading dialogs: when they close
  // and they were opened from the End Shift Report picker, reopen it instead
  // of leaving the cashier with nothing on screen.
  const handleReadingDialogOpenChange = (setOpen: (v: boolean) => void) => (open: boolean) => {
    setOpen(open);
    if (!open && returnToEndShiftReport) {
      setReturnToEndShiftReport(false);
      setShowEndShiftReport(true);
    }
  };

  const handleOpenCashTransfer = () => {
    if (businessSettings?.enableCashTransferAuth) setIsCashTransferPreAuthOpen(true);
    else setIsCashTransferOpen(true);
  };

  // Tax calculations
  const taxDetails = useMemo(() => {
    let vatSales = 0, vatAmount = 0, nonVatSales = 0, zeroRatedSales = 0, vatExemptSales = 0, subTotal = 0;
    items.forEach(item => {
      const itemTotal = item.price * item.quantity;
      const net = itemTotal - (itemTotal * item.discount) / 100;
      subTotal += net;
      const baseTaxType = item.taxType || mapVatStatusToTaxType(item.vatStatus);
      const taxType = resolveEffectiveTaxType(baseTaxType, item.discountType, item.discount);
      if (taxType === 'VAT') { const vatable = net / 1.12; vatSales += vatable; vatAmount += net - vatable; }
      else if (taxType === 'NON_VAT') nonVatSales += net;
      else if (taxType === 'ZERO_RATED') zeroRatedSales += net;
      else if (taxType === 'VAT_EXEMPT') vatExemptSales += net;
    });
    return { vatSales, vatAmount, nonVatSales, zeroRatedSales, vatExemptSales, subTotal };
  }, [items]);

  const totalDue = useMemo(() => items.reduce((acc, item) => {
    const t = item.price * item.quantity;
    return acc + (t - (t * item.discount) / 100);
  }, 0), [items]);

  const subTotal = taxDetails.subTotal;
  const vatSales = taxDetails.vatSales;
  const vatAmount = taxDetails.vatAmount;
  const numberOfItems = items.reduce((acc, item) => acc + item.quantity, 0);

  const pointsMethod = useMemo(() => paymentMethods.find(pm => pm.name.toUpperCase() === 'POINTS'), [paymentMethods]);
  const pointsRate = useMemo(() => {
    if (!pointsMethod?.pointsAmount || !pointsMethod?.currencyEquivalent) return 1;
    return Number(pointsMethod.currencyEquivalent) / Number(pointsMethod.pointsAmount);
  }, [pointsMethod]);

  const customerPoints = (selectedCustomer as any)?.current_points || (selectedCustomer as any)?.loyaltyPoints || 0;
  const customerPointsValue = Number(customerPoints) * pointsRate;

  const showOverlay = !isPosLoggedIn || !shiftActive;

  const handleCheckoutComplete = (change: number, orNumber: string) => {
    if (enableCustomerDisplay) {
      cdSend({ type: 'PAYMENT_COMPLETE', change, orNumber, currency: businessSettings?.currencySymbol || '₱' });
    }
  };

  return {
    // refs
    inputRef,
    // terminal & session
    currentShiftId, selectedTerminalId, currentTerminalName, terminals,
    currentTime, shiftActive, isPosLoggedIn, isCheckingShift, isEndingShift,
    currentUser, businessSettings, isTrainingMode, enableCustomerDisplay,
    openOnSecondScreen, showQuantityInSearch, enablePriceLevelPicker, showOverlay,
    // frontliner / queue
    isFrontliner, queuedOrders, editingQueueOrder, isQueuePanelOpen, setIsQueuePanelOpen,
    isSendToQueueOpen, setIsSendToQueueOpen,
    isFrontlinerPromptOpen, setIsFrontlinerPromptOpen,
    isFrontlinerBlocked,
    handleSendToQueue, handleConfirmSendToQueue, handleClaimQueuedOrder, handleRecallQueuedOrder,
    // shift dialogs
    isCashCountAuthOpen, setIsCashCountAuthOpen,
    cashCountAuthCredentials,
    isEndShiftOpen, setIsEndShiftOpen,
    startingCash, cashSales, otherPaymentMethods, membershipCash, cashDeposits, cashPickups,
    isCashTransferOpen, setIsCashTransferOpen,
    isCashTransferPreAuthOpen, setIsCashTransferPreAuthOpen,
    handleOpenCashTransfer,
    isCollisionOpen, collisionShift,
    showEndShiftReport, setShowEndShiftReport,
    handleOpenOverallReadingFromEndShiftReport,
    handleOpenXReadingFromEndShiftReport,
    handleOpenZReadingWarningFromEndShiftReport,
    handleReadingDialogOpenChange,
    lastEndedShiftId,
    // cart
    items, inputValue, setInputValue, inventoryLocation,
    selectedItemId, setSelectedItemId, selectedItem,
    editingNameItemId, setEditingNameItemId,
    editingQtyItemId, setEditingQtyItemId,
    editingPriceItemId, setEditingPriceItemId,
    qtyDraft, setQtyDraft,
    heldTransactions, isHeldTransOpen, setIsHeldTransOpen,
    isSuspendNoteOpen, setIsSuspendNoteOpen,
    isProductSearchOpen, setIsProductSearchOpen,
    isInsufficientStockOpen, setIsInsufficientStockOpen, insufficientItems,
    // payment
    paymentMethods, isTenderDialogOpen, setIsTenderDialogOpen, tenderMethod,
    // discount
    isDiscountDialogOpen, setIsDiscountDialogOpen,
    // customer
    selectedCustomer, isCustomerSelectOpen, setIsCustomerSelectOpen,
    isLoyaltyOpen, setIsLoyaltyOpen,
    customerPoints, customerPointsValue,
    // readings
    isZReadingOpen, setIsZReadingOpen,
    isZReadingWarningOpen, setIsZReadingWarningOpen,
    zReadingWarningOpenChange,
    handleConfirmZReadingWarning,
    isOverallReadingOpen, setIsOverallReadingOpen,
    isXReadingOpen, setIsXReadingOpen,
    isPriceInquiryOpen, setIsPriceInquiryOpen,
    // other dialogs
    isRecentSalesOpen, setIsRecentSalesOpen,
    isVoidSalesOpen, setIsVoidSalesOpen,
    isReturnSalesOpen, setIsReturnSalesOpen,
    isShutdownConfirmOpen, setIsShutdownConfirmOpen,
    // auth dialogs
    isLineVoidAuthOpen, setIsLineVoidAuthOpen, lineVoidAuthCredentials, pendingVoidItemId,
    isVoidLineChoiceOpen, setIsVoidLineChoiceOpen, handleVoidLineChoice,
    isPriceEditAuthOpen, setIsPriceEditAuthOpen, priceEditAuthCredentials,
    isDiscountAuthOpen, setIsDiscountAuthOpen, discountAuthCredentials, handleDiscountAuthSuccess,
    isEditItemAuthOpen, setIsEditItemAuthOpen, editItemAuthCredentials, handleEditItemAuthSuccess,
    isEditQtyAuthOpen, setIsEditQtyAuthOpen, editQtyAuthCredentials, handleEditQtyAuthSuccess,
    isSuspendAuthOpen, setIsSuspendAuthOpen, suspendAuthCredentials, handleSuspendAuthSuccess,
    isSuspendedAuthOpen, setIsSuspendedAuthOpen, suspendedAuthCredentials, handleSuspendedAuthSuccess,
    handleOpenSuspended,
    isOverallReadingAuthOpen, setIsOverallReadingAuthOpen, overallReadingAuthCredentials,
    xReadingAuthCredentials, zReadingAuthCredentials,
    // price levels
    priceLevels, selectedPriceLevelId, setSelectedPriceLevelId,
    activeLevelId, defaultLevelId, activeLevelName,
    // The Edit Price dialog (Task 5) prices its preview with priceLineFor and
    // labels a line's pick with priceLevelNameFor, so both resolve exactly as
    // the cart does rather than re-deriving the rules in the UI.
    priceLineFor, priceLevelNameFor,
    // products (for search filters)
    products,
    // totals
    totalDue, subTotal, vatSales, vatAmount, taxDetails, numberOfItems,
    // handlers
    handleAddItem, handleAddItemBySKU, getSearchSuggestions, findExactCodeMatch, updateQuantity, handleUpdateItem,
    handleVoidLine, performVoidLine, focusInlineQuantity,
    removeItem, handleSuccessfulSale,
    handleOpenTender, handleDefaultTender,
    handleOpenEditDialog, handleOpenDiscountDialog, handleApplyDiscount,
    handleHold, confirmHold, handleRestore, handleDeleteHeld,
    handleStartShift, handleConfirmEndShift,
    handlePosLoginSuccess, handleContinueShift, handleTakeoverStartNew,
    handleLogout, handleShutdown,
    handleRequestPriceEdit, unlockInlinePrice, commitInlinePrice, handlePriceEditAuthSuccess,
    requestInlinePriceEdit,
    handleSelectCustomer, handleOpenLoyalty,
    handleOpenEndShift,
    startEditName, unlockInlineName, commitInlineName, commitQty,
    handleCheckoutComplete,
  };
}

