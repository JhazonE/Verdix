'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Coins, Tags, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from './returns-types';

interface Props {
  totals: {
    revenue: number;
    cost: number;
    profit: number;
    vatableSales: number;
    vatAmount: number;
  };
}

export function ReturnsSummaryCards({ totals }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Revenue</CardTitle>
          <div className="h-4 w-4 flex items-center justify-center text-muted-foreground font-semibold text-base">₱</div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">{formatCurrency(totals.revenue)}</div>
          <p className="text-xs text-muted-foreground">Total returned sales amount</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Cost</CardTitle>
          <Coins className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">{formatCurrency(totals.cost)}</div>
          <p className="text-xs text-muted-foreground">Total product cost</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Profit</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={cn('text-2xl font-bold', totals.profit >= 0 ? 'text-green-600' : 'text-red-600')}>
            {formatCurrency(totals.profit)}
          </div>
          <p className="text-xs text-muted-foreground">Revenue minus cost</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Vatable Sales</CardTitle>
          <Tags className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-purple-600">{formatCurrency(totals.vatableSales)}</div>
          <p className="text-xs text-muted-foreground">Sales excluding VAT</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">VAT Amount</CardTitle>
          <Percent className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">{formatCurrency(totals.vatAmount)}</div>
          <p className="text-xs text-muted-foreground">Total VAT collected</p>
        </CardContent>
      </Card>
    </div>
  );
}
