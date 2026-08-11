import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { format } from 'date-fns';
import { formatSINumber } from '@/lib/si-number';

const peso = (n: number) => (Number(n) || 0).toFixed(2);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date'); // Format: yyyy-MM-dd
    const terminalId = searchParams.get('terminalId');

    if (!date) {
      return NextResponse.json({ success: false, error: 'Date is required' }, { status: 400 });
    }

    const terminalFilter = terminalId && terminalId !== 'all' ? ' AND pt.terminal_id = ?' : '';

    // ── Detail rows: one line per item, but transaction-level totals
    //    (VAT/TOTAL/STATUS) are attached only so we can print them once per SI.
    const itemsSql = `
      SELECT
        st.id                                                     as sale_id,
        COALESCE(NULLIF(st.si_number, ''), st.reference)          as si_number,
        u.display_name                                            as cashier,
        si.product_name,
        si.quantity,
        si.price,
        pti.tax_type,
        pt.tax_amount                                             as txn_vat,
        st.total                                                  as txn_total,
        st.status,
        st.created_at,
        si.id                                                     as item_id
      FROM sales_transactions st
      JOIN pos_transactions pt ON st.id = pt.sale_id
      JOIN sale_items si ON st.id = si.sale_id
      LEFT JOIN pos_transaction_items pti ON pti.sale_item_id = si.id
      JOIN users u ON pt.user_id = u.uid
      WHERE DATE(st.created_at) = ? AND st.is_training = 0${terminalFilter}
      ORDER BY st.created_at ASC, si.id ASC
    `;

    // ── Per-transaction totals for the daily summary (avoids per-item double count).
    const txnSql = `
      SELECT
        st.id                                             as sale_id,
        COALESCE(NULLIF(st.si_number, ''), st.reference)  as si_number,
        st.bir_or_number,
        pt.subtotal,
        pt.tax_amount,
        pt.discount_amount,
        pt.total_amount,
        st.total,
        st.status,
        st.created_at
      FROM sales_transactions st
      JOIN pos_transactions pt ON st.id = pt.sale_id
      WHERE DATE(st.created_at) = ? AND st.is_training = 0${terminalFilter}
      ORDER BY st.created_at ASC
    `;

    // ── Tax-type breakdown across all line items (VATable / Exempt / Zero-rated / Non-VAT).
    const taxSql = `
      SELECT pti.tax_type, SUM(pti.line_total) as amount
      FROM sales_transactions st
      JOIN pos_transactions pt ON st.id = pt.sale_id
      JOIN pos_transaction_items pti ON pti.pos_transaction_id = pt.id
      WHERE DATE(st.created_at) = ? AND st.is_training = 0${terminalFilter}
      GROUP BY pti.tax_type
    `;

    const params: any[] = [date];
    if (terminalFilter) params.push(terminalId);

    const [items, txns, taxRows] = await Promise.all([
      query(itemsSql, params) as Promise<any[]>,
      query(txnSql, params) as Promise<any[]>,
      query(taxSql, params) as Promise<any[]>,
    ]);

    // ── Build the file ──────────────────────────────────────────────────────
    const bar = '-'.repeat(132);
    let content = `E-JOURNAL EXPORT - ${date}\n`;
    content += `Generated on: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}\n`;
    content += `Terminal: ${terminalId || 'All'}\n`;
    content += `${bar}\n`;
    content += `${'DATE'.padEnd(12)} | ${'TIME'.padEnd(8)} | ${'SI#'.padEnd(15)} | ${'CASHIER'.padEnd(15)} | ${'ITEM'.padEnd(30)} | ${'QTY'.padEnd(6)} | ${'PRICE'.padEnd(10)} | ${'VAT'.padEnd(10)} | ${'TOTAL'.padEnd(10)} | ${'STATUS'}\n`;
    content += `${bar}\n`;

    // Print VAT/TOTAL/STATUS only on the first line of each SI so per-item rows
    // no longer duplicate the whole-transaction amounts.
    let lastSaleId: string | null = null;
    items.forEach(t => {
      const firstOfSale = t.sale_id !== lastSaleId;
      lastSaleId = t.sale_id;
      const line = [
        format(new Date(t.created_at), 'yyyy-MM-dd').padEnd(12),
        format(new Date(t.created_at), 'HH:mm:ss').padEnd(8),
        (firstOfSale ? formatSINumber(t.si_number) : '').padEnd(15),
        (firstOfSale ? (t.cashier || '') : '').substring(0, 15).padEnd(15),
        (t.product_name || '').substring(0, 30).padEnd(30),
        String(t.quantity || 0).padEnd(6),
        peso(t.price).padEnd(10),
        (firstOfSale ? peso(t.txn_vat) : '').padEnd(10),
        (firstOfSale ? peso(t.txn_total) : '').padEnd(10),
        firstOfSale ? (t.status || '') : '',
      ].join(' | ');
      content += line + '\n';
    });

    content += `${bar}\n`;

    // ── Daily summary (must reconcile with the Z-Reading) ───────────────────
    const isVoid = (s: string) => ['void', 'voided', 'cancelled', 'canceled', 'refunded', 'returned'].includes(String(s || '').toLowerCase());
    const validTxns = txns.filter(t => !isVoid(t.status));
    const voidTxns = txns.filter(t => isVoid(t.status));

    const grossSales = validTxns.reduce((a, t) => a + Number(t.total || t.total_amount || 0), 0);
    const totalVat = validTxns.reduce((a, t) => a + Number(t.tax_amount || 0), 0);
    const totalDiscount = validTxns.reduce((a, t) => a + Number(t.discount_amount || 0), 0);

    const taxByType: Record<string, number> = {};
    taxRows.forEach(r => { taxByType[String(r.tax_type || 'VAT').toUpperCase()] = Number(r.amount || 0); });

    const siNumbers = validTxns.map(t => formatSINumber(t.si_number)).sort();
    const beginSI = siNumbers[0] || 'N/A';
    const endSI = siNumbers[siNumbers.length - 1] || 'N/A';

    // bir_or_number (services) is an independent BIR numbering sequence from
    // si_number (goods) — filter to only transactions that actually have one
    // before sorting, so an all-goods day produces an empty OR list (and
    // "N/A") rather than a meaningless range.
    const orNumbers = validTxns
      .filter(t => t.bir_or_number)
      .map(t => String(t.bir_or_number))
      .sort();
    const beginOR = orNumbers[0] || 'N/A';
    const endOR = orNumbers[orNumbers.length - 1] || 'N/A';

    content += `DAILY SUMMARY\n`;
    content += `${bar}\n`;
    content += `Beginning SI#            : ${beginSI}\n`;
    content += `Ending SI#               : ${endSI}\n`;
    content += `Beginning OR#            : ${beginOR}\n`;
    content += `Ending OR#               : ${endOR}\n`;
    content += `No. of Sales Invoices    : ${validTxns.length}\n`;
    content += `Voided / Cancelled       : ${voidTxns.length}\n`;
    content += `\n`;
    content += `VATable Sales            : ${peso(taxByType['VAT'])}\n`;
    content += `VAT-Exempt Sales         : ${peso(taxByType['VAT_EXEMPT'])}\n`;
    content += `Zero-Rated Sales         : ${peso(taxByType['ZERO_RATED'])}\n`;
    content += `Non-VAT Sales            : ${peso(taxByType['NON_VAT'])}\n`;
    content += `VAT Amount (12%)         : ${peso(totalVat)}\n`;
    content += `Total Discounts          : ${peso(totalDiscount)}\n`;
    content += `${bar}\n`;
    content += `GROSS SALES (incl. VAT)  : ${peso(grossSales)}\n`;
    content += `${bar}\n`;
    content += `END OF REPORT\n`;

    // Record the export timestamp.
    if (items.length > 0) {
      await query('UPDATE pos_settings SET last_ejournal_export = NOW() WHERE 1=1');
    }

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="ejournal_${date}_${terminalId || 'all'}.txt"`,
      },
    });

  } catch (error: any) {
    console.error('Error generating e-journal:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
