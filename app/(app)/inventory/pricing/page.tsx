import { Suspense } from 'react';
import { Tags } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import PricingClient from './PricingClient';

export default function PricingPage() {
  return (
    <div className="flex flex-col -m-4 sm:-m-6 h-[calc(100svh-4rem)]">
      {/* Page Header */}
      <div className="shrink-0 bg-card border-b border-border px-4 md:px-6 py-3 md:py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Tags className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-bold tracking-tight leading-tight">Pricing</h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden md:block">
              Apply a price, cost, markup%, or price-level change to many products at once.
            </p>
          </div>
        </div>
      </div>

      {/* Client Content — fills remaining height */}
      <Suspense fallback={<PricingSkeleton />}>
        <PricingClient />
      </Suspense>
    </div>
  );
}

function PricingSkeleton() {
  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 gap-0">
      <div className="flex-1 flex flex-col gap-4 p-6">
        <Skeleton className="h-11 w-full rounded-xl" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      </div>
      <div className="w-full md:w-[340px] border-l border-border p-6 space-y-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}
