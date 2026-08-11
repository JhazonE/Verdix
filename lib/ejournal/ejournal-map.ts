import type {
  EJSale, EJCredit, EJReading, EJItem,
} from './types';

export const num = (v: any) => (v == null ? 0 : Number(v)) || 0;

export function mapReadingRow(row: any, type: 'X' | 'Z'): EJReading {
  return {
    readingNumber: row.reading_number,
    type,
    reportDate: String(row.report_date),
    terminalId: row.terminal_id ?? undefined,
    cashierName: row.cashier_name ?? undefined,
    grossSales: num(row.gross_sales),
    returns: num(row.returns),
    discounts: num(row.discounts),
    netSales: num(row.net_sales),
    vatAmount: num(row.vat_amount),
    transactionCount: num(row.transaction_count),
  };
}

export function groupItems(rows: any[]): EJItem[] {
  return rows.map((r) => ({
    name: r.product_name,
    quantity: num(r.quantity),
    price: num(r.price ?? r.unit_price),
    discount: num(r.discount_amount),
    unitOfMeasure: r.unit_of_measure ?? undefined,
  }));
}

export function groupSales(rows: any[]): EJSale[] {
  const map = new Map<string, EJSale>();
  for (const r of rows) {
    const key = String(r.sale_id);
    if (!map.has(key)) {
      map.set(key, {
        siNumber: r.si_number,
        birOrNumber: r.bir_or_number ?? null,
        cashierName: r.cashier,
        customerName: r.customer,
        dateTime: r.dt,
        paymentMethod: r.payment_method,
        total: num(r.total),
        vatAmount: num(r.vat),
        items: [],
      });
    }
    map.get(key)!.items.push({
      name: r.product_name,
      quantity: num(r.quantity),
      price: num(r.price),
    });
  }
  return [...map.values()];
}

export function groupCredits(rows: any[]): EJCredit[] {
  const map = new Map<string, EJCredit>();
  for (const r of rows) {
    const key = String(r.pos_id);
    if (!map.has(key)) {
      map.set(key, {
        creditSiNumber: r.credit_si,
        originalSiNumber: r.orig_si,
        cashierName: r.cashier,
        customerName: r.customer,
        dateTime: r.dt,
        total: Math.abs(num(r.total)),
        items: [],
      });
    }
    if (r.product_name) {
      map.get(key)!.items.push({
        name: r.product_name,
        quantity: Math.abs(num(r.quantity)),
        price: num(r.price),
      });
    }
  }
  return [...map.values()];
}
