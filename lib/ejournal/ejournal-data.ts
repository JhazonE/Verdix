import { query } from '../mysql';
import type {
  EJournalData, EJSettings, EJSale, EJVoided, EJCredit, EJReading,
} from './types';
import { mapReadingRow, groupSales, groupCredits } from './ejournal-map';

export async function fetchEJournalData(date: string, terminalId?: string): Promise<EJournalData> {
  const useTerminal = !!(terminalId && terminalId !== 'all');
  const tFilterPt = useTerminal ? ' AND pt.terminal_id = ?' : '';
  const tFilterCol = useTerminal ? ' AND terminal_id = ?' : '';

  // Settings
  const settingsRows = (await query(
    `SELECT business_name, address, contact_number, tin, vat_registration,
            min_number, serial_number, paper_size
     FROM pos_settings LIMIT 1`
  )) as any[];
  const s = settingsRows?.[0] || {};
  const settings: EJSettings = {
    businessName: s.business_name,
    address: s.address,
    contactNumber: s.contact_number,
    tin: s.tin,
    vatRegistration: s.vat_registration,
    minNumber: s.min_number,
    serialNumber: s.serial_number,
    paperSize: s.paper_size,
  };

  // Sales invoices (status Paid) — one row per (sale,item); group in code.
  const saleRows = (await query(
    `SELECT st.id AS sale_id,
            COALESCE(NULLIF(st.si_number,''), st.reference) AS si_number,
            st.bir_or_number AS bir_or_number,
            u.display_name AS cashier, c.name AS customer, st.created_at AS dt,
            st.payment_method, st.total, pt.tax_amount AS vat,
            si.product_name, si.quantity, si.price
     FROM sales_transactions st
     JOIN pos_transactions pt ON pt.sale_id = st.id
     JOIN sale_items si ON si.sale_id = st.id
     LEFT JOIN users u ON pt.user_id = u.uid
     LEFT JOIN customers c ON st.customer_id = c.id
     WHERE DATE(st.created_at) = ? AND st.is_training = 0 AND st.status = 'Paid' AND si.quantity > 0${tFilterPt}
     ORDER BY st.created_at ASC, si.id ASC`,
    useTerminal ? [date, terminalId] : [date]
  )) as any[];
  const salesInvoices: EJSale[] = groupSales(saleRows);

  // Voided
  const voidRows = (await query(
    `SELECT st.id AS sale_id,
            COALESCE(NULLIF(st.si_number,''), st.reference) AS si_number,
            st.bir_or_number AS bir_or_number,
            u.display_name AS cashier, c.name AS customer, st.created_at AS dt,
            st.payment_method, st.total, pt.tax_amount AS vat, st.void_reason,
            si.product_name, si.quantity, si.price
     FROM sales_transactions st
     JOIN pos_transactions pt ON pt.sale_id = st.id
     JOIN sale_items si ON si.sale_id = st.id
     LEFT JOIN users u ON pt.user_id = u.uid
     LEFT JOIN customers c ON st.customer_id = c.id
     WHERE DATE(st.created_at) = ? AND st.is_training = 0 AND st.status = 'Voided' AND si.quantity > 0${tFilterPt}
     ORDER BY st.created_at ASC, si.id ASC`,
    useTerminal ? [date, terminalId] : [date]
  )) as any[];
  const voided: EJVoided[] = groupSales(voidRows).map((v: any) => ({
    ...v,
    voidReason: voidRows.find((r) => String(r.si_number) === String(v.siNumber))?.void_reason ?? undefined,
  }));

  // Merchandise credits (returns)
  const creditRows = (await query(
    `SELECT pt.id AS pos_id,
            COALESCE(pt.si_number, st.si_number) AS credit_si,
            orig.si_number AS orig_si,
            u.display_name AS cashier, c.name AS customer, pt.transaction_time AS dt,
            pt.total_amount AS total,
            pti.product_name, pti.quantity, pti.unit_price AS price
     FROM pos_transactions pt
     LEFT JOIN sales_transactions st ON pt.sale_id = st.id
     LEFT JOIN pos_transactions orig ON (orig.sale_id = pt.sale_id AND orig.transaction_type = 'sale')
     LEFT JOIN users u ON pt.user_id = u.uid
     LEFT JOIN customers c ON st.customer_id = c.id
     LEFT JOIN pos_transaction_items pti ON pti.pos_transaction_id = pt.id
     WHERE pt.transaction_type = 'return' AND DATE(pt.transaction_time) = ?${tFilterPt}
     ORDER BY pt.transaction_time ASC`,
    useTerminal ? [date, terminalId] : [date]
  )) as any[];
  const merchandiseCredits: EJCredit[] = groupCredits(creditRows);

  // X / Z readings — guard against missing tables on older DBs.
  const xReadings = await safeReadings(
    `SELECT * FROM x_readings WHERE report_date = ?${tFilterCol} ORDER BY reading_number ASC`,
    useTerminal ? [date, terminalId] : [date], 'X'
  );
  const zReadings = await safeReadings(
    `SELECT * FROM z_readings WHERE report_date = ?${tFilterCol} ORDER BY reading_number ASC`,
    useTerminal ? [date, terminalId] : [date], 'Z'
  );

  return { settings, salesInvoices, voided, merchandiseCredits, xReadings, zReadings };
}

async function safeReadings(sql: string, params: any[], type: 'X' | 'Z'): Promise<EJReading[]> {
  try {
    const rows = (await query(sql, params)) as any[];
    return rows.map((r) => mapReadingRow(r, type));
  } catch {
    return [];
  }
}
