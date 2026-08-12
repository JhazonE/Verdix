/**
 * Types for the Sta. Lucia Tenant Management System "Sale Consolidator" API.
 * Field names and types are dictated by the external contract — see
 * docs/superpowers/specs/2026-07-31-sta-lucia-sales-consolidator-design.md
 */

/** Credentials issued by the mall for the tenant account. NOT a Verdix login. */
export interface StaLuciaCredentials {
  email: string;
  password: string;
}

export interface StaLuciaLoginResponse {
  status: number | boolean;
  role?: string;
  token: string;
  owner_token: string;
  user?: { id: number; name: string; email: string; status: number };
}

export interface StaLuciaSalesPayload {
  credit: number;
  debit: number;
  gross_sales: number;
  date_time: string;
  /** String percentage, e.g. "12.5%". Named "total_discounts" but is not an amount. */
  total_discounts: string;
  vat_exempt_sales: number;
  vat_sales: number;
  non_vat_sales: number;
  vat_amount: number;
  other_taxes: number;
  net_sales: number;
  /** true = hourly sale, false = end-of-day. Verdix only ever submits full-day Z-readings, so always false. */
  sale_type: boolean;
}

/**
 * The subset of a Verdix Z-reading the mapper needs. Declared structurally so
 * the mapper stays a pure function with no dependency on the Z-reading route.
 */
export interface ZReadingLike {
  id: string;
  reportDate: Date | string;
  grossSales: number;
  netSales: number;
  discounts: number;
  vatSales: number;
  vatAmount: number;
  vatExempt: number;
  nonVat: number;
  transactionCount: number;
  cashSales: number;
  paymentMethods: Array<{ name: string; amount: number }>;
}

/**
 * Pre-aggregated store-wide totals for one clock hour, computed by the
 * caller (send-hourly-sales.ts) from sales_transactions /
 * pos_transaction_items. Unlike ZReadingLike this has no `id` or
 * `transactionCount` — hourly submissions don't carry a running total or a
 * BIR sequence range the way Z-readings do.
 */
export interface HourlySalesTotals {
  hourStart: Date | string;
  grossSales: number;
  discounts: number;
  vatSales: number;
  vatAmount: number;
  vatExempt: number;
  nonVat: number;
  cashSales: number;
  paymentMethods: Array<{ name: string; amount: number }>;
}

/** Cached session for one configured API. */
export interface StaLuciaSession {
  token: string;
  ownerToken: string;
}
