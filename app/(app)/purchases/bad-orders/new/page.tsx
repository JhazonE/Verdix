'use client';

import { useRouter } from 'next/navigation';
import { RecordBadOrderForm } from '../record-bad-order/record-bad-order-form';

export default function NewBadOrderPage() {
  const router = useRouter();
  // The list refetches on mount, so returning to it is enough after a save.
  const goBack = () => router.push('/purchases/bad-orders');
  return <RecordBadOrderForm onClose={goBack} onSuccess={goBack} />;
}
