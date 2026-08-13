'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { useToast } from '@/hooks/use-toast';
import { useProducts } from '@/hooks/use-api';
import { useCustomerDisplay } from '@/hooks/use-customer-display';
import { useLiveRefresh, dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { calculateEffectivePrice } from '@/lib/pricing';
import { resolveEffectiveTaxType } from '@/lib/tax-utils';
import { getApiUrl } from '@/lib/api-config';
import { formatStockQuantity } from '@/lib/utils';
import { WALK_IN_CUSTOMER } from '../customer-account/customer-account-types';
import { type SaleItem, type SuspendedTransaction, type QueuedOrder, mapVatStatusToTaxType } from './pos-types';
import type { Customer, SystemSettings } from '@/lib/types';

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

  const [isTenderDialogOpen, setIsTenderDialogOpen] = useState(false);
  const [tenderMethod, setTenderMethod] = useState<string | null>(null);
  const [heldTransactions, setHeldTransactions] = useState<SuspendedTransaction[]>([]);
  const [isSuspendNoteOpen, setIsSuspendNoteOpen] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [startingCash, setStartingCash] = useState(0);
  const [cashSales, setCashSales] = useState(0);
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
  const [editItemAuthCredentials, setEditItemAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isEditItemAuthOpen, setIsEditItemAuthOpen] = useState(false);
  const [suspendAuthCredentials, setSuspendAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isSuspendAuthOpen, setIsSuspendAuthOpen] = useState(false);
  const [suspendedAuthCredentials, setSuspendedAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
  const [isSuspendedAuthOpen, setIsSuspendedAuthOpen] = useState(false);
  const [isOverallReadingAuthOpen, setIsOverallReadingAuthOpen] = useState(false);
  const [overallReadingAuthCredentials, setOverallReadingAuthCredentials] = useState<{ username?: string | null; password?: string | null } | null>(null);
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
  const [qtyDraft, setQtyDraft] = useState('');
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [isCollisionOpen, setIsCollisionOpen] = useState(false);
  const [collisionShift, setCollisionShift] = useState<any>(null);
  const [isCheckingShift, setIsCheckingShift] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string; isActive: boolean; isReferenceRequired?: boolean; pointsAmount?: number; currencyEquivalent?: number }[]>([]);
  const [showQuantityInSearch, setShowQuantityInSearch] = useState(true);

  // Sticky focus on main input when all dialogs close
  useEffect(() => {
    const isAnyDialogOpen =
      isTenderDialogOpen || isDiscountDialogOpen || isHeldTransOpen || isLineVoidAuthOpen ||
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
        setCurrentUser(JSON.parse(storedUser));
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

  const selectedItem = useMemo(() => items.find(item => item.id === selectedItemId) || null, [items, selectedItemId]);

  // Scroll to selected item
  useEffect(() => {
    if (selectedItemId) {
      document.getElementById(`pos-item-${selectedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedItemId]);

  // Sync qty draft and cancel inline edits on row change
  useEffect(() => {
    setQtyDraft(selectedItem ? String(selectedItem.quantity) : '');
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
    const item = items.find(i => i.id === itemId);
    if (item) {
      const newName = rawValue.trim();
      if (newName && newName !== item.name) handleUpdateItem(itemId, newName, item.quantity, item.price, item.discount);
    }
    setEditingNameItemId(null);
  };

  const commitQty = (itemId: string) => {
    setEditingQtyItemId(null);
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const q = parseFloat(qtyDraft);
    if (isNaN(q) || q <= 0) { setQtyDraft(String(item.quantity)); return; }
    if (q !== item.quantity) updateQuantity(itemId, q);
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
        setEditItemAuthCredentials({ username: result.data.editItemAuthUsername, password: result.data.editItemAuthPassword });
        setSuspendAuthCredentials({ username: result.data.suspendAuthUsername, password: result.data.suspendAuthPassword });
        setSuspendedAuthCredentials({ username: result.data.suspendedAuthUsername, password: result.data.suspendedAuthPassword });
        setOverallReadingAuthCredentials({ username: result.data.overallReadingAuthUsername, password: result.data.overallReadingAuthPassword });
        setIsTrainingMode(result.data.isTrainingMode || false);
        setShowQuantityInSearch(result.data.showQuantityInSearch ?? true);
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

  // Queue polling — only for non-frontliner cashiers when logged in & shift active
  useEffect(() => {
    if (!isPosLoggedIn || !shiftActive || isFrontliner) return;
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
      const isDialogOpen = document.querySelector('[role="dialog"]') !== null;

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
            const item = items.find(i => i.id === selectedItemId);
            if (item) updateQuantity(selectedItemId, item.quantity + 1);
          }
          break;
        }
        case '-': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (selectedItemId && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const item = items.find(i => i.id === selectedItemId);
            if (item && item.quantity > 1) updateQuantity(selectedItemId, item.quantity - 1);
          }
          break;
        }
        case 'ArrowUp': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (items.length > 0 && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const idx = items.findIndex(i => i.id === selectedItemId);
            setSelectedItemId(items[idx <= 0 ? items.length - 1 : idx - 1].id);
          }
          break;
        }
        case 'ArrowDown': {
          const isInputFocused = document.activeElement === inputRef.current;
          const isInputEmpty = inputRef.current ? inputRef.current.value === '' : true;
          if (items.length > 0 && (!isInputFocused || isInputEmpty) && !isDialogOpen) {
            e.preventDefault();
            const idx = items.findIndex(i => i.id === selectedItemId);
            setSelectedItemId(items[idx >= items.length - 1 ? 0 : idx + 1].id);
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

  // Re-price items when price level changes
  useEffect(() => {
    if (!activeLevelId) return;
    setItems(currentItems => {
      if (currentItems.length === 0) return currentItems;
      const updated = currentItems.map(item => ({ ...item, price: calculateEffectivePrice(item, item.quantity, activeLevelId, defaultLevelId) }));
      const changed = JSON.stringify(currentItems.map(i => i.price)) !== JSON.stringify(updated.map(i => i.price));
      return changed ? updated : currentItems;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLevelId]);

  // Handlers
  const handleAddItem = (product: any | undefined) => {
    if (product) {
      const existing = items.find(item => item.id === product.id);
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
        const existing = prevItems.find(item => item.id === product.id);
        if (existing) {
          const newQty = existing.quantity + 1;
          const newPrice = calculateEffectivePrice(product, newQty, activeLevelId, defaultLevelId);
          return prevItems.map(item => item.id === product.id ? { ...item, quantity: newQty, price: newPrice } : item);
        } else {
          const newItem: SaleItem = {
            ...product, quantity: 1, discount: 0, name: product.name,
            price: calculateEffectivePrice(product, 1, activeLevelId, defaultLevelId),
            taxType: mapVatStatusToTaxType(product.vatStatus),
          };
          setSelectedItemId(newItem.id);
          return [...prevItems, newItem];
        }
      });
    } else {
      toast({ title: 'Error', description: 'Product not found', variant: 'destructive' });
    }
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const getSearchSuggestions = useCallback((query: string, limit = 8): any[] => {
    const q = query.trim().toLowerCase();
    if (!q || !products) return [];
    const exactCode: any[] = [];
    const exactName: any[] = [];
    const partial: any[] = [];
    for (const p of products) {
      const sku = (p.sku || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      if (sku === q || barcode === q) exactCode.push(p);
      else if (name === q) exactName.push(p);
      else if (sku.includes(q) || barcode.includes(q) || name.includes(q)) partial.push(p);
    }
    return [...exactCode, ...exactName, ...partial].slice(0, limit);
  }, [products]);

  const handleAddItemBySKU = (sku: string) => {
    if (!sku) return;
    const product = getSearchSuggestions(sku, 1)[0];
    handleAddItem(product);
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeItem(productId);
    } else {
      setItems(prevItems => prevItems.map(item => {
        if (item.id === productId) {
          const original = products?.find(p => p.id === productId);
          return { ...item, quantity: newQuantity, price: calculateEffectivePrice(original || item, newQuantity, activeLevelId, defaultLevelId) };
        }
        return item;
      }));
    }
  };

  const handleUpdateItem = (itemId: string, newName: string, newQty: number, newPrice: number, newDiscount: number) => {
    setItems(prev => prev.map(item => item.id === itemId ? { ...item, name: newName, quantity: newQty, price: newPrice, discount: newDiscount } : item));
  };

  const handleVoidLine = (itemId: string | null) => {
    if (!itemId) { toast({ title: 'No Item Selected', description: 'Please select an item to void.', variant: 'destructive' }); return; }
    if (enableLineVoidAuth) { setPendingVoidItemId(itemId); setIsLineVoidAuthOpen(true); }
    else performVoidLine(itemId);
  };

  const performVoidLine = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    removeItem(itemId);
    if (selectedItemId === itemId) setSelectedItemId(null);
    setPendingVoidItemId(null);
    toast({ title: 'Line Voided', description: `Removed ${item.name} from the cart.` });
  };

  const focusInlineQuantity = (itemId: string | null) => {
    if (!itemId) { toast({ title: 'No Item Selected', description: 'Please select an item to adjust quantity.', variant: 'destructive' }); return; }
    setSelectedItemId(itemId);
    setEditingQtyItemId(itemId);
    setEditingNameItemId(null);
    setEditingPriceItemId(null);
    focusInlineField('pos-qty', itemId);
  };

  const removeItem = (productId: string) => {
    setItems(items.filter(item => item.id !== productId));
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
        }),
      });
      const result = await response.json();
      if (result.success) {
        setItems([]);
        setSelectedItemId(null);
        setSelectedCustomer(WALK_IN_CUSTOMER);
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
        setItems(result.data.items);
        setQueuedOrders(prev => prev.filter(o => o.id !== orderId));
        setIsQueuePanelOpen(false);
        toast({ title: `Order #${result.data.queueNumber} Loaded`, description: `From ${result.data.frontlinerName || 'frontliner'}.` });
      } else throw new Error(result.error);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to claim order.', variant: 'destructive' });
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
        const lowStock = items.filter(item => item.type !== 'service' && item.quantity > item.stock);
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
    if (selectedItem) startEditName(selectedItem.id);
    else toast({ title: 'No Item Selected', description: 'Please select an item to edit.', variant: 'destructive' });
  };

  const handleOpenDiscountDialog = () => {
    if (selectedItem) setIsDiscountDialogOpen(true);
    else toast({ title: 'No Item Selected', description: 'Please select an item to apply a discount.', variant: 'destructive' });
  };

  const handleApplyDiscount = (itemId: string | 'ALL', percentage: number, discountType?: string, discountDetails?: { idNumber?: string; holderName?: string }) => {
    const discountIdNumber = discountDetails?.idNumber;
    const discountHolderName = discountDetails?.holderName;
    if (itemId === 'ALL') {
      setItems(items.map(item => ({ ...item, discount: percentage, discountType, discountIdNumber, discountHolderName })));
      toast({ title: 'Global Discount Applied', description: `Applied ${percentage.toFixed(2)}% discount to all items.` });
    } else {
      setItems(items.map(item => item.id === itemId ? { ...item, discount: percentage, discountType, discountIdNumber, discountHolderName } : item));
      toast({ title: 'Discount Applied', description: `Discount updated to ${percentage.toFixed(2)}%` });
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
    setItems(heldTransactions[index].items);
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setStartingCash(cash);
        setCashSales(0);
        setMembershipCash(0);
        setShiftActive(true);
        setCurrentShiftId(result.data.shiftId);
        localStorage.setItem('pos_current_shift_id', result.data.shiftId);
        toast({ title: 'Shift Started', description: 'You are now ready to make sales.' });
      } else throw new Error(result.error);
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to start shift: ' + error.message, variant: 'destructive' });
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
        setItems(parsed.items || []);
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
      }
    } catch (error: any) {
      toast({ title: 'Takeover Failed', description: error.message, variant: 'destructive' });
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
      else unlockInlinePrice(selectedItem.id);
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
    const item = items.find(i => i.id === itemId);
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
    setIsZReadingWarningOpen(true);
  };

  const handleConfirmZReadingWarning = () => {
    setIsZReadingWarningOpen(false);
    setIsZReadingOpen(true);
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
    openOnSecondScreen, showQuantityInSearch, showOverlay,
    // frontliner / queue
    isFrontliner, queuedOrders, isQueuePanelOpen, setIsQueuePanelOpen,
    isSendToQueueOpen, setIsSendToQueueOpen,
    isFrontlinerPromptOpen, setIsFrontlinerPromptOpen,
    isFrontlinerBlocked,
    handleSendToQueue, handleConfirmSendToQueue, handleClaimQueuedOrder,
    // shift dialogs
    isCashCountAuthOpen, setIsCashCountAuthOpen,
    cashCountAuthCredentials,
    isEndShiftOpen, setIsEndShiftOpen,
    startingCash, cashSales, membershipCash, cashDeposits, cashPickups,
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
    isPriceEditAuthOpen, setIsPriceEditAuthOpen, priceEditAuthCredentials,
    isEditItemAuthOpen, setIsEditItemAuthOpen, editItemAuthCredentials, handleEditItemAuthSuccess,
    isSuspendAuthOpen, setIsSuspendAuthOpen, suspendAuthCredentials, handleSuspendAuthSuccess,
    isSuspendedAuthOpen, setIsSuspendedAuthOpen, suspendedAuthCredentials, handleSuspendedAuthSuccess,
    handleOpenSuspended,
    isOverallReadingAuthOpen, setIsOverallReadingAuthOpen, overallReadingAuthCredentials,
    // price levels
    priceLevels, selectedPriceLevelId, setSelectedPriceLevelId,
    activeLevelId, defaultLevelId, activeLevelName,
    // products (for search filters)
    products,
    // totals
    totalDue, subTotal, vatSales, vatAmount, taxDetails, numberOfItems,
    // handlers
    handleAddItem, handleAddItemBySKU, getSearchSuggestions, updateQuantity, handleUpdateItem,
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

