'use client';

import { useMemo } from 'react';
import type { Sale } from '@/lib/types';
import { DateRange } from 'react-day-picker';
import { isPastDue, daysPastDue } from '@/lib/due-date';

export const formatAmount = (val: any) =>
  Number(val || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What has actually been settled on an invoice. Reads the stored figure rather than
 * inferring it from `status`, which cannot express a part-payment. The `Paid` fallback
 * covers older rows written before amount_paid was carried on this payload.
 */
export const getAmountPaid = (sale: Sale) => {
  // A voided invoice no longer exists as a sale: whatever was paid on it went
  // back to the customer as account credit (see the void route), so it must
  // not count as money collected. amount_paid stays on the row as history.
  if (sale.status === 'Voided') return 0;
  if (sale.amountPaid != null) return Number(sale.amountPaid);
  return sale.status === 'Paid' ? sale.total : 0;
};

/** What is still owed. A voided invoice owes nothing. */
export const getBalance = (sale: Sale) =>
  sale.status === 'Voided' ? 0 : sale.total - getAmountPaid(sale);

export const isOverDue = (sale: Sale) => {
  if (sale.status === 'Paid' || sale.status === 'Voided' || sale.status === 'Returned') return false;
  // By calendar day: an invoice due today is not overdue until today is over.
  // See lib/due-date.ts.
  return isPastDue(sale.dueDate);
};

export const getStatusInfo = (sale: Sale): { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } => {
  if (sale.status === 'Voided') return { text: 'Voided', variant: 'destructive' };
  switch (sale.status) {
    case 'Paid': return { text: 'Paid', variant: 'default' };
    case 'Failed':
    case 'Returned': return { text: sale.status, variant: 'destructive' };
    case 'Shipped':
    case 'Delivered': return { text: sale.status, variant: 'outline' };
    // A partly-settled invoice is still owed, so it keeps the due/overdue treatment
    // rather than reading as closed — the label just says it was part-paid.
    case 'Partially Paid':
    case 'Pending':
    default: {
      const partial = sale.status === 'Partially Paid';
      const diffDays = daysPastDue(sale.dueDate);
      if (diffDays > 0) {
        return { text: `Over Due ${diffDays} day${diffDays === 1 ? '' : 's'}`, variant: 'destructive' };
      }
      return { text: partial ? 'Partially Paid' : 'Due', variant: 'secondary' };
    }
  }
};

type UtilsParams = {
  salesInvoices: Sale[];
  searchQuery: string;
  statusFilter: string;
  dateRangeFilter: DateRange | undefined;
  salesPersonFilter: string;
  customerFilter: string;
  transactionSourceFilter: string;
  referenceTypeFilter: string;
  referenceNumberFilter: string;
  receiptNumberFilter: string;
};

export function useInvoicesUtils({
  salesInvoices, searchQuery, statusFilter, dateRangeFilter, salesPersonFilter,
  customerFilter, transactionSourceFilter, referenceTypeFilter, referenceNumberFilter, receiptNumberFilter,
}: UtilsParams) {
  const uniqueSalesPersons = useMemo(
    () => Array.from(new Set(salesInvoices.map((s: Sale) => s.salesPerson).filter(Boolean))),
    [salesInvoices]
  );

  const relevantSales = useMemo(
    () => salesInvoices.filter((s: Sale) => {
      // Voided invoices leave this list entirely and are reviewed on Post Void
      // (/sales/voids), the same rule the Sales Transactions page follows. The
      // void itself already restored the stock and refunded what qualifies.
      if (!['Paid', 'Partially Paid', 'Shipped', 'Delivered', 'Pending'].includes(s.status)) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matches =
          s.customer?.name?.toLowerCase().includes(query) ||
          s.salesPerson?.toLowerCase().includes(query) ||
          s.reference?.toString().toLowerCase().includes(query) ||
          (s as any).receiptNo?.toString().toLowerCase().includes(query) ||
          s.orderNumber?.toString().includes(query) ||
          s.id.toLowerCase().includes(query);
        if (!matches) return false;
      }
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (dateRangeFilter?.from) {
        const saleDate = new Date(s.invoiceDate || s.date || '');
        if (saleDate < dateRangeFilter.from) return false;
        if (dateRangeFilter.to && saleDate > dateRangeFilter.to) return false;
      }
      if (salesPersonFilter !== 'all' && s.salesPerson !== salesPersonFilter) {
        if (!s.salesPerson && salesPersonFilter === 'unassigned') {
          // allow
        } else {
          return false;
        }
      }
      if (salesPersonFilter === 'unassigned' && s.salesPerson) return false;
      if (customerFilter && !s.customer?.name?.toLowerCase().includes(customerFilter.toLowerCase())) return false;
      if (transactionSourceFilter !== 'all' && s.transactionSource !== transactionSourceFilter) return false;
      const displayRef = s.reference || s.id.substring(0, 8);
      if (referenceNumberFilter && !displayRef.toLowerCase().includes(referenceNumberFilter.toLowerCase())) return false;
      const recNo = (s as any).receiptNo?.toString() || s.orderNumber?.toString() || '';
      if (receiptNumberFilter && !recNo.toLowerCase().includes(receiptNumberFilter.toLowerCase())) return false;
      return true;
    }),
    [salesInvoices, searchQuery, statusFilter, dateRangeFilter, salesPersonFilter,
     customerFilter, transactionSourceFilter, referenceTypeFilter, referenceNumberFilter, receiptNumberFilter]
  );

  const summaryTotals = useMemo(
    () => relevantSales.reduce((acc, sale) => {
      // Voided invoices stay in the list (marked Voided) but are left out of
      // every total — they appear on the Voided Sales report instead.
      if (sale.status === 'Voided') return acc;
      const amountPaid = getAmountPaid(sale);
      const balance = getBalance(sale);
      const overdue = isOverDue(sale);
      return {
        total: acc.total + sale.total,
        amountPaid: acc.amountPaid + amountPaid,
        balance: acc.balance + balance,
        due: acc.due + (overdue ? 0 : balance),
        overDue: acc.overDue + (overdue ? balance : 0),
      };
    }, { total: 0, amountPaid: 0, balance: 0, due: 0, overDue: 0 }),
    [relevantSales]
  );

  return { uniqueSalesPersons, relevantSales, summaryTotals };
}
