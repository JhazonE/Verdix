import { format } from 'date-fns';
import { getApiUrl } from '@/lib/api-config';

/** One sold line, as `/api/sales/product-transactions` returns it. */
export interface ProductTransactionLine {
  productId: string;
  productName: string;
  date: string;
  orderNumber: string;
  siNumber: string | null;
  customerName: string;
  quantity: number;
  /** Per selling unit. */
  price: number;
  /** Per selling unit, from the sale-time snapshot. */
  unitCost: number;
  discount: number;
  /** Line total, net of discount. */
  total: number;
  /** quantity * unitCost. */
  lineCost: number;
  /** total - lineCost. */
  profit: number;
}

export interface FetchDetailParams {
  startDate?: string;
  endDate?: string;
  terminalId?: string;
  category?: string;
  brand?: string;
  cashier?: string;
  search?: string;
}

export interface ProductTransactionDetail {
  /** Lines grouped by product id, each already in date order. */
  byProduct: Map<string, ProductTransactionLine[]>;
  /** True when the row cap was hit, so some products are missing detail. */
  truncated: boolean;
  total: number;
}

/**
 * Fetches the transaction detail for EVERY product matching the report's
 * filters, in one request.
 *
 * Deliberately not `/api/sales/transactions?productId=` in a loop: that is one
 * round trip per product, which on a remote DB is the shape that has already
 * caused trouble for product import and checkout here. A 15,000-product report
 * would mean 15,000 requests.
 */
export async function fetchProductTransactionDetail(
  params: FetchDetailParams
): Promise<ProductTransactionDetail> {
  const qs = new URLSearchParams();
  if (params.startDate) qs.append('startDate', params.startDate);
  if (params.endDate) qs.append('endDate', params.endDate);
  if (params.terminalId && params.terminalId !== 'all') qs.append('terminalId', params.terminalId);
  if (params.category && params.category !== 'all') qs.append('category', params.category);
  if (params.brand && params.brand !== 'all') qs.append('brand', params.brand);
  if (params.cashier && params.cashier !== 'all') qs.append('cashier', params.cashier);
  if (params.search) qs.append('search', params.search);

  const res = await fetch(getApiUrl(`/sales/product-transactions?${qs.toString()}`));
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const result = await res.json();
  // A 200 carrying success:false is how these APIs report their own errors.
  if (!result.success) throw new Error(result.error || 'Could not load transaction detail.');

  const byProduct = new Map<string, ProductTransactionLine[]>();
  for (const line of (result.data || []) as ProductTransactionLine[]) {
    const list = byProduct.get(line.productId);
    if (list) list.push(line);
    else byProduct.set(line.productId, [line]);
  }

  return {
    byProduct,
    truncated: Boolean(result.truncated),
    total: (result.data || []).length,
  };
}

const money = (n: number) =>
  n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Column headers of the detail block, in order. */
export const DETAIL_HEADERS = [
  'Date', 'Order # / SI No.', 'Customer', 'Qty', 'Price', 'Cost Price', 'Total', 'Total Cost', 'Profit',
];

/**
 * One detail line as display strings, matching the on-screen expander column
 * for column so an exported file reads the same as the page it came from.
 */
export function detailCells(line: ProductTransactionLine): string[] {
  return [
    format(new Date(line.date), 'MMM dd, yyyy HH:mm'),
    line.siNumber ? `${line.orderNumber} / ${line.siNumber}` : line.orderNumber,
    line.customerName,
    String(line.quantity),
    money(line.price),
    money(line.unitCost),
    money(line.total),
    money(line.lineCost),
    money(line.profit),
  ];
}
