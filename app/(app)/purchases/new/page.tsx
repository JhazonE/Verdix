'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAddPurchaseOrder } from '../add-purchase-order/use-add-purchase-order';
import { PurchaseOrderForm } from '../add-purchase-order/purchase-order-form';

function NewPurchaseOrder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const goBack = () => router.push('/purchases');

  // The hook's "open" flag drives its init effect (reference number, warehouses,
  // prefill). A page is always open; closing it (after a save) means leaving.
  const controller = useAddPurchaseOrder({
    open: true,
    onOpenChange: (open) => { if (!open) goBack(); },
    // e.g. launched from a supplier's scheduled-order shortcut
    prefillSupplierId: searchParams.get('supplierId') || undefined,
  });

  return <PurchaseOrderForm controller={controller} isEdit={false} onCancel={goBack} />;
}

export default function NewPurchaseOrderPage() {
  return (
    <Suspense fallback={null}>
      <NewPurchaseOrder />
    </Suspense>
  );
}
