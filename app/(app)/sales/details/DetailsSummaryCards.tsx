'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, TrendingUp, CreditCard, Percent, PhilippinePeso, FileText, Banknote, Tag, Wallet } from 'lucide-react';
import { formatAmount } from './use-details-utils';

type SummaryTotals = {
  revenue: number;
  discounts: number;
  amountPaid: number;
  customerBalance: number;
  cost: number;
  grossProfit: number;
  vatableSales: number;
  vatAmount: number;
  nonVatSales: number;
  accountPayments: number;
  /** Sales in the range, returns excluded. */
  transactions?: number;
};

type Props = { totals: SummaryTotals; transactionCount: number };

const CARDS = [
  { key: 'revenue',         label: 'Total Revenue',      Icon: () => <span className="text-green-600 font-bold text-base leading-none">₱</span>,  color: 'text-green-600' },
  { key: 'transactionCount',label: 'Transactions',        Icon: ShoppingCart, color: 'text-blue-600' },
  { key: 'grossProfit',     label: 'Gross Profit',        Icon: TrendingUp,  color: 'text-emerald-600' },
  { key: 'amountPaid',      label: 'Amount Paid',         Icon: CreditCard,  color: 'text-indigo-600' },
  { key: 'discounts',       label: 'Total Discounts',     Icon: Percent,     color: 'text-orange-600' },
  { key: 'customerBalance', label: 'Customer Balance',    Icon: Wallet,      color: 'text-yellow-600' },
  { key: 'cost',            label: 'Total Cost',          Icon: Tag,         color: 'text-red-600' },
  { key: 'vatableSales',    label: 'Vatable Sales',       Icon: PhilippinePeso, color: 'text-purple-600' },
  { key: 'vatAmount',       label: 'VAT Amount',          Icon: FileText,    color: 'text-pink-600' },
  { key: 'accountPayments', label: 'Account Payments',    Icon: Banknote,    color: 'text-cyan-600' },
] as const;

export function DetailsSummaryCards({ totals, transactionCount }: Props) {
  const values: Record<string, number> = { ...totals, transactionCount };

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
      {CARDS.map(({ key, label, Icon, color }) => (
        <Card key={key}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{label}</CardTitle>
            <Icon className={`h-4 w-4 ${color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {key === 'transactionCount'
                ? values[key]
                : formatAmount(values[key])}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
