
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format } from 'date-fns';
import { OverallReadingData } from '@/app/(app)/sales/overall-reading/overall-reading-preview';

// Characters per line: 58mm thermal paper = 32, 80mm = 48 (matches
// ReceiptGenerator.getLayout and the X/Z-reading generators).
const widthFor = (paperSize?: string) => (paperSize === '80mm' ? 48 : 32);

// The thermal print MUST mirror the on-screen preview
// (app/(app)/sales/overall-reading/OverallReadingReceipt.tsx): same sections,
// same order, same show/hide conditions. They are two separate renderers of
// one report, and this one used to print only the header plus the
// terminal/cashier tables, dropping Summary, Payment Methods, VAT Breakdown
// and Cash Summary. If you add a section to one, add it to the other.
export class OverallReadingGenerator {
    private encoder: any;

    constructor() {
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: widthFor()
        });
    }

    public generate(data: OverallReadingData, paperSize?: string): Uint8Array {
        const W = widthFor(paperSize);
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: W
        });

        const { terminalId, terminalName, startDate, endDate, businessSettings, terminalInfo } = data;

        const fmt = (amount: number) =>
            (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const dash = '-'.repeat(W);

        // Label left, value right, padded to the line width.
        const row = (left: string, right: string) => {
            const spaces = W - left.length - right.length;
            if (spaces <= 0) return (left + ' ' + right).substring(0, W);
            return left + ' '.repeat(spaces) + right;
        };

        // NAME / TXNS / AMOUNT columns for the breakdown tables.
        const TXN_W = 6;
        const AMT_W = 12;
        const NAME_W = W - TXN_W - AMT_W;
        const row3 = (name: string, txns: string, amount: string) =>
            name.substring(0, NAME_W).padEnd(NAME_W) + txns.padStart(TXN_W) + amount.padStart(AMT_W);

        const enc = this.encoder.initialize().codepage('cp437');
        const center = () => enc.raw([0x1b, 0x61, 0x31]); // Native Center
        const left = () => enc.raw([0x1b, 0x61, 0x30]);   // Native Left
        const title = (text: string) => { center(); enc.bold(true).line(text).bold(false); left(); };
        const section = (text: string) => { title(text); enc.line(dash); };

        // ── HEADER ──────────────────────────────────────────────────────────
        center();
        enc.bold(true).line((businessSettings?.businessName || 'POS SYSTEM').toUpperCase()).bold(false);
        if (businessSettings?.address) enc.line(businessSettings.address);
        if (businessSettings?.tin) enc.line(`${businessSettings.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN'}: ${businessSettings.tin}`);
        if (terminalInfo?.min) enc.line(`MIN: ${terminalInfo.min}`);
        if (terminalInfo?.sn) enc.line(`S/N: ${terminalInfo.sn}`);
        if (terminalInfo?.permitNo) enc.line(`PTU NO: ${terminalInfo.permitNo}`);
        if (terminalInfo?.accreditationNo) enc.line(`ACCR NO: ${terminalInfo.accreditationNo}`);
        enc.line(`Terminal: ${terminalId}${terminalName ? ` (${terminalName})` : ''}`);
        left();

        enc.line(dash);
        title('OVERALL TERMINAL READING');
        enc.line(dash);

        // ── DATE RANGE ──────────────────────────────────────────────────────
        enc.line(row('From:', startDate ? format(new Date(startDate), 'MM/dd/yy hh:mm a') : '-'));
        enc.line(row('To:', format(new Date(endDate), 'MM/dd/yy hh:mm a')));
        enc.line(dash);

        // ── SUMMARY ─────────────────────────────────────────────────────────
        section('SUMMARY');
        enc.line(row('GROSS SALES:', fmt(data.grossSales)));
        if ((data.returnAmount || 0) > 0) enc.line(row(`RETURNS (${data.returnCount || 0}):`, `(${fmt(data.returnAmount)})`));
        if ((data.voidAmount || 0) > 0) enc.line(row(`VOIDS (${data.voidCount || 0}):`, `(${fmt(data.voidAmount)})`));
        if ((data.totalDiscounts || 0) > 0) enc.line(row('DISCOUNTS:', `(${fmt(data.totalDiscounts)})`));
        enc.line('='.repeat(W));
        enc.bold(true).line(row('NET SALES:', fmt(data.netSales))).bold(false);
        enc.line(row('TRANSACTIONS:', String(data.transactionCount || 0)));
        enc.line(dash);

        // ── PAYMENT METHODS ─────────────────────────────────────────────────
        if (data.paymentMethods && data.paymentMethods.length > 0) {
            section('PAYMENT METHODS');
            data.paymentMethods.forEach(pm => enc.line(row(`${pm.name.toUpperCase()}:`, fmt(pm.amount))));
            enc.line(dash);
        }

        // ── VAT BREAKDOWN ───────────────────────────────────────────────────
        section('VAT BREAKDOWN');
        enc.line(row('VATable Sales:', fmt(data.vatSales || 0)));
        enc.line(row('VAT (12%):', fmt(data.vatAmount || 0)));
        if ((data.vatExempt || 0) > 0) enc.line(row('VAT Exempt:', fmt(data.vatExempt)));
        if ((data.zeroRated || 0) > 0) enc.line(row('Zero Rated:', fmt(data.zeroRated)));
        if ((data.nonVat || 0) > 0) enc.line(row('Non-VAT:', fmt(data.nonVat)));
        enc.line(dash);

        // ── CASH SUMMARY ────────────────────────────────────────────────────
        if ((data.startingCash || 0) > 0 || (data.cashSales || 0) > 0) {
            section('CASH SUMMARY');
            enc.line(row('Starting Cash:', fmt(data.startingCash || 0)));
            enc.line(row('Cash Sales:', fmt(data.cashSales || 0)));
            enc.line(row('Expected in Drawer:', fmt(data.cashInDrawer || 0)));
            if ((data.actualCash || 0) > 0) enc.line(row('Actual Cash:', fmt(data.actualCash)));
            if ((data.variance || 0) !== 0) enc.line(row('Variance:', fmt(data.variance || 0)));
            enc.line(dash);
        }

        // ── TERMINAL BREAKDOWN ──────────────────────────────────────────────
        const terminals = (data.terminals || []).filter(t => t.netSales > 0 || t.transactionCount > 0);
        if (terminals.length > 0) {
            title('TERMINAL BREAKDOWN');
            enc.line(row3('TERMINAL', 'TXNS', 'AMOUNT'));
            enc.line(dash);
            terminals.forEach(t => enc.line(row3(String(t.terminalName || '').toUpperCase(), String(t.transactionCount), fmt(t.netSales))));
            enc.line(dash);
        }

        // ── CASHIER BREAKDOWN ───────────────────────────────────────────────
        const cashiers = (data.cashiers || []).filter(c => c.netSales > 0 || c.transactionCount > 0);
        if (cashiers.length > 0) {
            title('CASHIER BREAKDOWN');
            enc.line(row3('CASHIER', 'TXNS', 'AMOUNT'));
            enc.line(dash);
            cashiers.forEach(c => enc.line(row3(String(c.cashierName || '').toUpperCase(), String(c.transactionCount), fmt(c.netSales))));
            enc.line(dash);
        }

        // ── FOOTER ──────────────────────────────────────────────────────────
        enc.newline();
        center();
        enc.line('End of Overall Reading Report');
        enc.newline();
        enc.bold(true).line('THIS IS NOT AN OFFICIAL RECEIPT').bold(false);
        enc.newline().newline().newline();
        enc.cut();

        return enc.encode();
    }
}
