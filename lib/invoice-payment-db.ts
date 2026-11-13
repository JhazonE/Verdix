import { query } from '@/lib/mysql';

/**
 * payment_allocations is created lazily by the payment routes, so a fresh DB
 * may not have it yet. This is DDL, which commits implicitly in MySQL — it
 * must therefore run BEFORE a transaction opens, never inside one.
 */
export async function ensurePaymentAllocationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id VARCHAR(255) PRIMARY KEY,
      payment_id VARCHAR(255) NOT NULL,
      invoice_id VARCHAR(255) NOT NULL,
      amount_allocated DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_payment_id (payment_id),
      INDEX idx_invoice_id (invoice_id),
      CONSTRAINT fk_pa_payment FOREIGN KEY (payment_id) REFERENCES customer_payments(id) ON DELETE CASCADE
    )
  `);
}
