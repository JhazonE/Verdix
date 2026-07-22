import { Repeat, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import type { Product } from '@/lib/types';

export type AdjustmentType = 'add' | 'remove' | 'transfer';

export interface AdjustmentItem {
  product: Product;
  quantity: number;
  type: AdjustmentType;
  reason: string;
  expirationDate?: string;
}

export const typeConfig: Record<AdjustmentType, { label: string; color: string; icon: LucideIcon; dot: string }> = {
  add:      { label: 'Add Stock',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: TrendingUp,   dot: 'bg-emerald-500' },
  remove:   { label: 'Remove Stock', color: 'bg-red-50 text-red-700 border-red-200',             icon: TrendingDown, dot: 'bg-red-500'     },
  transfer: { label: 'Transfer',     color: 'bg-blue-50 text-blue-700 border-blue-200',           icon: Repeat,       dot: 'bg-blue-500'   },
};
