'use client';

import { useRouter } from 'next/navigation';
import { AddInvoiceForm } from '../add-invoice/AddInvoiceForm';

export default function NewSalesInvoicePage() {
  const router = useRouter();
  const goBack = () => router.push('/sales/invoices');
  return <AddInvoiceForm onClose={goBack} onSuccess={goBack} />;
}
