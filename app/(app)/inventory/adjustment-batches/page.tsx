import { Suspense } from 'react';
import { History } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

import AdjustmentBatchesClient from './AdjustmentBatchesClient';

export default function AdjustmentBatchesPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <History className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight leading-tight">
            Adjustment Batches
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Past bulk stock adjustments and transfers, grouped as transactions. Reprint any slip.
          </p>
        </div>
      </div>

      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <AdjustmentBatchesClient />
      </Suspense>
    </div>
  );
}
