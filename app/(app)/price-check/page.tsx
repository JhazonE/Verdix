'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PriceCheckScreen } from './PriceCheckScreen';

/**
 * The kiosk brings its own QueryClientProvider: the `(app)` layout's chrome
 * bypass returns `children` directly for chromeless screens, so the layout's
 * provider never wraps this page. Same pattern as `app/(app)/pos/page.tsx`.
 */
const queryClient = new QueryClient();

export default function PriceCheckPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <PriceCheckScreen />
    </QueryClientProvider>
  );
}
