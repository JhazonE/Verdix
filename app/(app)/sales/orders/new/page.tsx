'use client';

import { useRouter } from 'next/navigation';
import { AddOrderForm } from '../add-order/AddOrderForm';

export default function NewSalesOrderPage() {
  const router = useRouter();
  const goBack = () => router.push('/sales/orders');
  return <AddOrderForm onClose={goBack} onSuccess={goBack} />;
}
