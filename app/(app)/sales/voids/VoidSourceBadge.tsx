'use client';

import { Badge } from '@/components/ui/badge';
import type { VoidRecord } from './voids-types';

/** Same colours as the Trans Ref badge on Sales → Invoices. */
export function VoidSourceBadge({ source }: { source: VoidRecord['source'] }) {
  const backOffice = source === 'Back Office';
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap text-[10px] ${backOffice
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-orange-50 text-orange-700 border-orange-200'}`}
    >
      {source || 'POS'}
    </Badge>
  );
}
