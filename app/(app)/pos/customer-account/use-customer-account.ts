'use client';

import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { usePrinter } from '@/lib/use-printer';
import { formatQuantity } from '@/lib/utils';
import type { Customer, SystemSettings } from '@/lib/types';
import { format, differenceInDays } from 'date-fns';
import { WALK_IN_CUSTOMER } from './customer-account-types';

type Options = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelectCustomer: (customer: Customer | null) => void;
  initialCustomer?: Customer | null;
  printMode?: 'browser' | 'escpos' | 'usb' | 'native';
  settings?: SystemSettings | null;
};

export function useCustomerAccount({ isOpen, onOpenChange, onSelectCustomer, initialCustomer, printMode = 'native', settings }: Options) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(initialCustomer?.id || 'walk-in');
  const [customerDetails, setCustomerDetails] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [membershipCard, setMembershipCard] = useState<{ rfid_code: string | null; expiry_date: string | null; isExpired: boolean } | null>(null);
  const [isMembershipCardLoading, setIsMembershipCardLoading] = useState(false);
  const [isMembershipDialogOpen, setIsMembershipDialogOpen] = useState(false);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);

  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [activeInvoiceNo, setActiveInvoiceNo] = useState<string>('');
  const [activeInvoiceBalance, setActiveInvoiceBalance] = useState<number>(0);
  const [overpaymentMode, setOverpaymentMode] = useState<'change' | 'credit'>('change');
  const [lastPaymentData, setLastPaymentData] = useState<any>(null);
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);
  const [rfidInput, setRfidInput] = useState('');
  const [isRfidSearching, setIsRfidSearching] = useState(false);
  const [rfidError, setRfidError] = useState('');

  const rfidInputRef = useRef<HTMLInputElement>(null);
  const yesButtonRef = useRef<HTMLButtonElement>(null);
  const noButtonRef = useRef<HTMLButtonElement>(null);

  const { toast } = useToast();
  const { isConnected, connect, print } = usePrinter(printMode, settings?.nativePrinterName);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);

  const getInitials = (name: string) => {
    if (!name) return '??';
    const parts = name.split(' ');
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].substring(0, 2).toUpperCase();
  };

  const fetchCustomers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(getApiUrl('/customers?limit=100'));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) setCustomers(result.data);
    } catch (error) {
      console.error('Failed to fetch customers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMembershipCard = async () => {
    if (!selectedCustomerId || selectedCustomerId === 'walk-in') { setMembershipCard(null); return; }
    setIsMembershipCardLoading(true);
    try {
      const res = await fetch(getApiUrl(`/customer-loyalty?customerId=${encodeURIComponent(selectedCustomerId)}&limit=1`));
      const result = await res.json();
      if (result.success && result.data.length > 0) {
        const c = result.data[0];
        setMembershipCard({ rfid_code: c.rfid_code, expiry_date: c.expiry_date, isExpired: !!c.isExpired });
      } else {
        setMembershipCard(null);
      }
    } catch {
      setMembershipCard(null);
    } finally {
      setIsMembershipCardLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCustomers();
      setRfidInput('');
      setRfidError('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialCustomer) {
      setSelectedCustomerId(initialCustomer.id);
    } else {
      setSelectedCustomerId('walk-in');
    }
  }, [initialCustomer]);

  useEffect(() => {
    const fetchDetails = async () => {
      if (selectedCustomerId && selectedCustomerId !== 'walk-in') {
        setCustomerDetails(null);
        setTransactions([]);
        setPayments([]);
        setIsDetailsLoading(true);
        try {
          const [detailRes, transRes, payRes] = await Promise.all([
            fetch(getApiUrl(`/customers/${selectedCustomerId}`)),
            fetch(getApiUrl(`/pos/recent-sales?customerId=${selectedCustomerId}`)),
            fetch(getApiUrl(`/customers/payments?customerId=${selectedCustomerId}`)),
          ]);
          const [detailData, transData, payData] = await Promise.all([
            detailRes.json(), transRes.json(), payRes.json(),
          ]);
          if (detailData.success) setCustomerDetails(detailData.data);
          if (transData.success) setTransactions(transData.data);
          if (payData.success) setPayments(payData.data);
        } catch (error) {
          console.error('Failed to fetch customer details:', error);
        } finally {
          setIsDetailsLoading(false);
        }
      }
    };

    if (isOpen && selectedCustomerId) {
      if (selectedCustomerId === 'walk-in') {
        setCustomerDetails(null);
        setTransactions([]);
        setPayments([]);
        setMembershipCard(null);
      } else {
        fetchDetails();
        fetchMembershipCard();
      }
    }
  }, [isOpen, selectedCustomerId]);

  const refreshData = async () => {
    if (selectedCustomerId && selectedCustomerId !== 'walk-in') {
      setIsDetailsLoading(true);
      try {
        const [detailRes, transRes, payRes] = await Promise.all([
          fetch(getApiUrl(`/customers/${selectedCustomerId}`)),
          fetch(getApiUrl(`/pos/recent-sales?customerId=${selectedCustomerId}`)),
          fetch(getApiUrl(`/customers/payments?customerId=${selectedCustomerId}`)),
        ]);
        const [detailData, transData, payData] = await Promise.all([
          detailRes.json(), transRes.json(), payRes.json(),
        ]);
        if (detailData.success) setCustomerDetails(detailData.data);
        if (transData.success) setTransactions(transData.data);
        if (payData.success) setPayments(payData.data);
      } catch (error) {
        console.error('Failed to refresh data:', error);
      } finally {
        setIsDetailsLoading(false);
      }
    }
  };

  const handlePrintPaymentReceipt = async (paymentData: any) => {
    if (printMode === 'browser') {
      const { printPaymentReceipt } = await import('@/lib/print-payment-receipt');
      printPaymentReceipt({
        id: paymentData.reference,
        customerName: customerDetails?.name || 'Customer',
        date: paymentData.date,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentType,
        reference: paymentData.reference,
      });
      return;
    }
    try {
      if (!isConnected) {
        const connected = await connect();
        if (!connected) {
          toast({ title: 'Printer Not Connected', description: 'Could not connect to the printer.', variant: 'destructive' });
          return;
        }
      }
      const { ReceiptGenerator } = await import('@/lib/receipt-generator');
      const generator = new ReceiptGenerator();
      const bytes = generator.generatePaymentReceipt({
        customerName: customerDetails?.name || 'Customer',
        date: paymentData.date,
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentType,
        reference: paymentData.reference,
        note: paymentData.note,
        invoiceNo: paymentData.invoiceNo,
      }, settings);
      await print(bytes);
    } catch {
      toast({ title: 'Print Failed', description: 'Could not send data to printer.', variant: 'destructive' });
    }
  };

  const handleSubmitPayment = async () => {
    const amountValue = parseFloat(paymentAmount);
    if (!paymentAmount || isNaN(amountValue) || amountValue <= 0) {
      toast({ title: 'Invalid Amount', description: 'Please enter a valid payment amount.', variant: 'destructive' });
      return;
    }
    setIsSubmittingPayment(true);

    // Determine overpayment against the invoice balance and how to handle it.
    const balance = activeInvoiceBalance || 0;
    const overpayment = balance > 0 ? Math.max(0, amountValue - balance) : 0;
    // Portion applied to the invoice never exceeds the outstanding balance.
    const appliedAmount = overpayment > 0 ? balance : amountValue;
    // For 'change' the excess is handed back as cash, so only the applied portion is recorded.
    // For 'credit' the full amount is recorded; the unallocated excess becomes account credit.
    const recordedAmount = overpayment > 0 && overpaymentMode === 'change' ? balance : amountValue;
    const changeGiven = overpayment > 0 && overpaymentMode === 'change' ? overpayment : 0;
    const creditAdded = overpayment > 0 && overpaymentMode === 'credit' ? overpayment : 0;

    try {
      const response = await fetch(getApiUrl('/customers/payments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: selectedCustomerId,
          amount: recordedAmount,
          appliedAmount,
          paymentType,
          reference: paymentReference,
          note: creditAdded > 0 ? `${paymentNote} (incl. ${formatCurrency(creditAdded)} account credit)` : paymentNote,
          invoiceNo: activeInvoiceNo || undefined,
        }),
      });
      const result = await response.json();
      if (result.success) {
        const desc = changeGiven > 0
          ? `Payment recorded. Change due: ${formatCurrency(changeGiven)}.`
          : creditAdded > 0
            ? `Payment recorded. ${formatCurrency(creditAdded)} added as account credit.`
            : 'The customer payment has been recorded successfully.';
        toast({ title: 'Payment Recorded', description: desc });
        setLastPaymentData({ amount: recordedAmount, paymentType, reference: paymentReference, note: paymentNote, invoiceNo: activeInvoiceNo, date: new Date(), changeGiven, creditAdded });
        setIsPaymentDialogOpen(false);
        setTimeout(() => setShowPrintPrompt(true), 200);
        setPaymentAmount('');
        setPaymentReference('');
        setPaymentNote('');
        setActiveInvoiceNo('');
        setActiveInvoiceBalance(0);
        setOverpaymentMode('change');
        refreshData();
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast({ title: 'Payment Failed', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handlePaySpecific = (sale: any) => {
    const balance = sale.total - (sale.paidAmount || 0);
    const dbReference = sale.reference;
    const displayRef = sale.orderNumber || sale.receiptNo || sale.id.substring(0, 8);
    setPaymentAmount(balance.toString());
    setPaymentReference(`${displayRef}-PAY-${Date.now().toString().slice(-4)}`);
    setPaymentNote(`Payment for ${displayRef}`);
    setActiveInvoiceNo(dbReference);
    setActiveInvoiceBalance(balance);
    setOverpaymentMode('change');
    onOpenChange(false);
    setTimeout(() => setIsPaymentDialogOpen(true), 150);
  };

  const handleRfidSearch = async () => {
    const code = rfidInput.trim();
    if (!code) return;
    setIsRfidSearching(true);
    setRfidError('');
    try {
      const res = await fetch(getApiUrl(`/customer-loyalty/lookup?rfid=${encodeURIComponent(code)}`));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const result = await res.json();
      if (result.success && result.data) {
        const found = result.data;
        setCustomers(prev => prev.some(c => c.id === found.id) ? prev : [...prev, found]);
        setSelectedCustomerId(found.id);
        setRfidInput('');
      } else {
        setRfidError('No customer found for this RFID / Loyalty card.');
      }
    } catch {
      setRfidError('Failed to search. Please try again.');
    } finally {
      setIsRfidSearching(false);
    }
  };

  const handleCustomerAdded = (customer: any) => {
    setCustomers(prev => prev.some(c => c.id === customer.id) ? prev : [...prev, customer]);
    setSelectedCustomerId(customer.id);
  };

  const handleSelect = () => {
    const customer = customers.find(c => c.id === selectedCustomerId) || WALK_IN_CUSTOMER;
    onSelectCustomer(customer);
    onOpenChange(false);
  };

  const handlePrintPromptKeyDown = (e: React.KeyboardEvent) => {
    if (!showPrintPrompt) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (document.activeElement === yesButtonRef.current) {
        noButtonRef.current?.focus();
      } else {
        yesButtonRef.current?.focus();
      }
    } else if (e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (lastPaymentData) handlePrintPaymentReceipt(lastPaymentData);
      setShowPrintPrompt(false);
      setLastPaymentData(null);
      onOpenChange(true);
    } else if (e.key.toLowerCase() === 'n' || e.key === 'Escape') {
      e.preventDefault();
      setShowPrintPrompt(false);
      setLastPaymentData(null);
      onOpenChange(true);
    }
  };

  const allItems = transactions.flatMap(t =>
    t.items.map((item: any) => ({
      ...item,
      transactionDate: t.date,
      orderNumber: t.orderNumber,
      status: t.status,
      discountTotal: (item.price * item.quantity * (item.discountPercentage || 0)) / 100,
    }))
  );

  const pendingCharges = transactions.filter(t =>
    t.status !== 'Paid' && t.status !== 'Voided' && (t.total - (t.paidAmount || 0)) > 0
  );

  const overdueCharges = pendingCharges.filter(t =>
    t.dueDate && new Date(t.dueDate) < new Date()
  );

  return {
    customers, selectedCustomerId, setSelectedCustomerId,
    customerDetails, isLoading, isDetailsLoading,
    transactions, payments,
    isPaymentDialogOpen, setIsPaymentDialogOpen,
    paymentAmount, setPaymentAmount,
    paymentType, setPaymentType,
    paymentReference, setPaymentReference,
    paymentNote, setPaymentNote,
    isSubmittingPayment,
    activeInvoiceNo,
    activeInvoiceBalance,
    overpaymentMode, setOverpaymentMode,
    lastPaymentData,
    showPrintPrompt, setShowPrintPrompt,
    rfidInput, setRfidInput,
    isRfidSearching, rfidError,
    rfidInputRef, yesButtonRef, noButtonRef,
    fetchCustomers,
    handlePrintPaymentReceipt,
    handleSubmitPayment,
    handlePaySpecific,
    handleRfidSearch,
    handleSelect,
    handlePrintPromptKeyDown,
    formatCurrency,
    getInitials,
    allItems, pendingCharges, overdueCharges,
    membershipCard,
    isMembershipCardLoading,
    isMembershipDialogOpen,
    setIsMembershipDialogOpen,
    fetchMembershipCard,
    isAddCustomerOpen, setIsAddCustomerOpen, handleCustomerAdded,
    format, differenceInDays, formatQuantity,
  };
}
