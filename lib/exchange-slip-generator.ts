import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format } from 'date-fns';
import { SystemSettings } from './types';
import { formatSINumber } from './si-number';

export interface ExchangeSlipData {
    /** null in training mode, like siNumber — the MC series is skipped. */
    mcNumber: string | null;
    siNumber: string | null;
    date: string;
    cashierName: string;
    customerName: string;
    returnedItem: { name: string; quantity: number; price: number; total: number };
    newItem: { name: string; quantity: number; price: number; total: number };
    /** newItem.total - returnedItem.total. Positive = collected from customer, negative = credited. */
    balance: number;
    businessSettings?: SystemSettings | null;
}

export class ExchangeSlipGenerator {
    private encoder: any;

    constructor() { }

    private getLayout(settings?: SystemSettings | null) {
        const paperSize = settings?.paperSize || '58mm';
        if (paperSize === '80mm') {
            return { COLS: 48 };
        }
        // Default 58mm
        return { COLS: 32 };
    }

    public generate(data: ExchangeSlipData): Uint8Array {
        const settings = data.businessSettings;
        const { COLS } = this.getLayout(settings);

        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: COLS,
        });

        const dateStr = format(new Date(data.date), 'PP p');

        const enc = this.encoder.initialize().codepage('cp437');

        const bizName = settings?.businessName?.trim() || 'verdix';
        const address = settings?.address?.trim() || 'General Merchandise';

        // ─── HEADER (centered) ───────────────────────────────────────────
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(bizName);
        enc.line(address);
        if (settings?.contactNumber) enc.line(settings.contactNumber);
        if (settings?.tin)           enc.line(`VAT REG TIN: ${settings.tin}`);
        enc.line(dateStr);
        enc.raw([0x1b, 0x61, 0x30]); // Native Left
        enc.newline();

        // ─── SLIP HEADER ───────────────────────────────────────────
        enc.raw([0x1b, 0x61, 0x31]).line('EXCHANGE SLIP').raw([0x1b, 0x61, 0x30]);
        if (data.siNumber) enc.line(`SI NO.: ${formatSINumber(data.siNumber)}`);
        if (data.mcNumber) enc.line(`MC NO.: ${data.mcNumber}`);
        enc.line(`Cust: ${data.customerName}`);
        enc.line(`Cashier: ${data.cashierName}`);
        enc.line('-'.repeat(COLS)); // dashed border

        // ─── RETURNED / NEW ITEM SECTIONS ─────────────────────────────────
        enc.bold(true).line('RETURNED').bold(false);
        enc.line(`${data.returnedItem.quantity} x ${data.returnedItem.name}`);
        enc.line(`@ ${this.fmt(data.returnedItem.price)}  = ${this.fmt(data.returnedItem.total)}`);
        enc.newline();

        enc.bold(true).line('NEW ITEM').bold(false);
        enc.line(`${data.newItem.quantity} x ${data.newItem.name}`);
        enc.line(`@ ${this.fmt(data.newItem.price)}  = ${this.fmt(data.newItem.total)}`);
        enc.line('-'.repeat(COLS));

        // ─── BALANCE (omitted entirely for an even exchange) ──────────────
        if (Math.abs(data.balance) >= 0.005) {
            const label = data.balance > 0 ? 'PAYMENT COLLECTED:' : 'CREDIT TO ACCOUNT:';
            enc.bold(true).line(`${label} ${this.fmt(Math.abs(data.balance))}`).bold(false);
            enc.line('-'.repeat(COLS));
        }

        // ─── FOOTER ────────────────────────────────────────────
        enc.newline();
        enc.align('center');
        enc.line('Exchange Transaction Record');
        enc.line('Printed: ' + format(new Date(), 'MM/dd/yy h:mm a'));

        enc.newline().newline().newline();
        enc.cut();

        return enc.encode();
    }

    private fmt(amount: number): string {
        return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
}
