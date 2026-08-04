import type { Sale } from '@/lib/types';

export const formatCurrency = (amount: number) =>
  amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function mapSaleToReceiptDetails(sale: Sale) {
  const mappedItems = sale.items.map(item => {
    const gross = item.price * item.quantity;
    const discountPercent = gross > 0 ? ((item.discount || 0) / gross) * 100 : 0;
    return {
      ...item.product,
      price: item.price,
      quantity: item.quantity,
      discount: discountPercent,
      name: item.product.name
    };
  });

  const vatableGross = mappedItems.reduce((acc, item) => {
    const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
    const taxType = item.taxType;
    return taxType === 'VAT' ? acc + netItemTotal : acc;
  }, 0);

  const vatableSales = vatableGross / 1.12;
  const vatAmountResult = vatableGross - vatableSales;

  const vatExemptSales = mappedItems.reduce((acc, item) => {
    const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
    return item.taxType === 'VAT_EXEMPT' ? acc + netItemTotal : acc;
  }, 0);

  const zeroRatedSales = mappedItems.reduce((acc, item) => {
    const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
    return item.taxType === 'ZERO_RATED' ? acc + netItemTotal : acc;
  }, 0);

  const nonVatSales = mappedItems.reduce((acc, item) => {
    const netItemTotal = item.price * item.quantity * (1 - (item.discount || 0) / 100);
    return item.taxType === 'NON_VAT' ? acc + netItemTotal : acc;
  }, 0);

  return {
    items: mappedItems,
    customer: sale.customer,
    totalDue: sale.total,
    change: sale.change || 0,
    paymentMethod: sale.paymentMethod,
    payments: sale.payments,
    orderNumber: sale.orderNumber ? String(sale.orderNumber) : sale.id,
    siNumber: sale.siNumber ? String(sale.siNumber) : undefined,
    amountTendered: sale.amountTendered || sale.total,
    transactionDate: sale.date ? new Date(sale.date) : new Date(),
    cashierName: sale.cashierName || sale.salesPerson,
    pointsEarned: sale.pointsEarned || 0,
    terminalMin: sale.terminalMin,
    terminalSerialNumber: sale.terminalSerialNumber,
    terminalPermitNo: sale.terminalPermitNo,
    terminalAccreditationNo: sale.terminalAccreditationNo,
    terminalPermitDateIssued: sale.terminalPermitDateIssued,
    pointsUsedCount: sale.pointsUsedCount || 0,
    pointsBalance: sale.pointsBalance ?? 0,
    paymentReference: sale.paymentReference,
    taxBreakdown: {
      vatableSales,
      vatAmount: vatAmountResult,
      vatExemptSales,
      zeroRatedSales,
      nonVatSales
    }
  };
}
