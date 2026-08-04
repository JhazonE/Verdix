import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format } from 'date-fns';
import { SystemSettings } from './types';
import { formatSINumber } from './si-number';

export class VoidSlipGenerator {
    private encoder: any;

    constructor() { }

    private getLayout(settings?: SystemSettings | null) {
        const paperSize = settings?.paperSize || '58mm';
        if (paperSize === '80mm') {
            const COLS = 48;
            const QTY_W = 8;
            const AMT_W = 12;
            const NAME_W = COLS - QTY_W - AMT_W;
            return { COLS, QTY_W, AMT_W, NAME_W };
        }
        // Default 58mm
        const COLS = 32;
        const QTY_W = 7;
        const AMT_W = 9;
        const NAME_W = COLS - QTY_W - AMT_W;
        return { COLS, QTY_W, AMT_W, NAME_W };
    }

    public generateVoidSlip(sale: any, settings?: SystemSettings | null): Uint8Array {
        const { COLS, QTY_W, AMT_W, NAME_W } = this.getLayout(settings);
        
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: COLS,
        });

        const enc = this.encoder.initialize().codepage('cp437');

        const bizName = settings?.businessName?.trim() || 'VENDIX';
        const address = settings?.address?.trim() || 'General Merchandise';
        const minNumber = sale.terminalMin || settings?.minNumber || '1234567890';
        const serialNumber = sale.terminalSerialNumber || settings?.serialNumber || '0987654321-11';
        const accreditationNo = sale.terminalAccreditationNo;
        const permitNo = sale.terminalPermitNo;
        const dateStr = format(new Date(), 'PP p');

        // ─── HEADER (centered) ───────────────────────────────────────────
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(bizName);
        enc.line(address);
        if (settings?.contactNumber) enc.line(settings.contactNumber);
        if (settings?.tin)           enc.line(`VAT REG TIN: ${settings.tin}`);
        enc.line(`MIN: ${minNumber}`);
        enc.line(`S/N: ${serialNumber}`);
        if (accreditationNo) enc.line(`ACCR NO: ${accreditationNo}`);
        if (permitNo)        enc.line(`PTU NO: ${permitNo}`);
        enc.line(dateStr);
        enc.raw([0x1b, 0x61, 0x30]); // Native Left
        enc.newline();

        // ─── TITLE ──────────────────────────────────────────────
        enc.align('center').line('VOID SLIP').align('left');
        enc.newline();

        // ─── TRANSACTION INFO ───────────────────────────────────────────
        const siNo = formatSINumber(sale.siNumber || sale.orderNumber);
        enc.bold(true).line(`SI NO.: ${siNo}`).bold(false);
        enc.line(`Date: ${format(new Date(sale.date || new Date()), 'MM/dd/yy h:mm a')}`);
        enc.line(`Cust: ${sale.customer?.name || 'Walk-in'}`);
        enc.line(`Cashier: ${sale.cashierName || 'Admin'}`);
        if (sale.terminalName) {
            enc.line(`Terminal: ${sale.terminalName}`);
        }
        enc.line('-'.repeat(COLS));

        // ─── ITEM TABLE HEADER ────────────────────────────────────────────
        const pad = ' '; 
        const hdrQty  = 'Qty'.padEnd(QTY_W, pad);
        const hdrName = 'Item'.padEnd(NAME_W, pad);
        const hdrAmt  = 'Amt'.padStart(AMT_W, pad);
        enc.bold(true).line(`${hdrQty}${hdrName}${hdrAmt}`).bold(false);
        enc.rule({ style: 'single' });

        const marginLeftDots = QTY_W * 12; 
        const nl = marginLeftDots % 256;
        const nh = Math.floor(marginLeftDots / 256);
        const absoluteIndent = () => {
             enc.raw([0x1b, 0x24, nl, nh]);
        };

        // ─── ITEMS ────────────────────────────────────────────────────────
        sale.items.forEach((item: any) => {
            const uomAbbr = this.abbreviateUOM(item.product?.unitOfMeasure || item.unitOfMeasure);
            const qtyStr  = `${item.quantity}${uomAbbr ? ' ' + uomAbbr : ''}`;
            const qty     = qtyStr.length > QTY_W ? qtyStr.substring(0, QTY_W) : qtyStr.padEnd(QTY_W, pad);
            
            const total = item.price * item.quantity;
            const amt = this.fmt(total).padStart(AMT_W, pad);
            
            const name = item.product?.name || item.name || 'Unknown';
            const chunks = this.wrap(name, NAME_W);
            const padName = (s: string) => s.length >= NAME_W ? s.substring(0, NAME_W) : s.padEnd(NAME_W, pad);

            enc.line(`${qty}${padName(chunks[0] || '')}${amt}`);
            for (let i = 1; i < chunks.length; i++) {
                absoluteIndent();
                enc.line(chunks[i]);
            }
            // Unit price line
            absoluteIndent();
            enc.line(`@ ${this.fmt(item.price)}`);
        });

        // ─── TOTALS ───────────────────────────────────
        enc.line('-'.repeat(COLS));
        enc.bold(true).line(this.row('TOTAL VOIDED:', this.fmt(sale.total), COLS)).bold(false);
        enc.newline();

        // REASON (If any)
        if (sale.voidReason) {
            enc.line('Reason:');
            const reasonChunks = this.wrap(sale.voidReason, COLS);
            reasonChunks.forEach(c => enc.line(c));
            enc.newline();
        }

        // ─── SIGNATURE SECTION ────────────────────────────
        enc.newline();
        enc.newline();
        enc.align('center');
        enc.line('__________________________');
        enc.line('Authorized Signature');
        enc.newline();
        enc.line('__________________________');
        enc.line('Cashier Signature');

        // ─── FOOTER ────────────────────────────
        enc.newline();
        enc.line('Void Transaction Record');
        enc.line('Pos System by Bhagoh');

        enc.newline().newline().newline();
        enc.cut();

        return enc.encode();
    }

    private abbreviateUOM(uom?: string): string {
        if (!uom) return '';
        const map: Record<string, string> = {
            'Pieces': 'pcs',
            'Piece': 'pc',
            'Kilograms': 'kg',
            'Kilogram': 'kg',
            'Kilos': 'kg',
            'Kilo': 'kg',
            'Grams': 'g',
            'Gram': 'g',
            'Meters': 'm',
            'Meter': 'm',
            'Liters': 'L',
            'Liter': 'L',
            'Boxes': 'bx',
            'Box': 'bx',
            'Case': 'cs',
            'Cases': 'cs',
            'Pack': 'pk',
            'Packs': 'pk',
            'Bottle': 'btl',
            'Bottles': 'btl',
            'Can': 'cn',
            'Cans': 'cn',
            'Milliliters': 'ml',
            'Milliliter': 'ml'
        };
        const trimmed = uom.trim();
        const upper = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
        return map[upper] || trimmed.toLowerCase();
    }

    private fmt(amount: number): string {
        return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    private row(left: string, right: string, width: number): string {
        const spaces = width - left.length - right.length;
        if (spaces <= 0) return `${left} ${right}`.substring(0, width);
        return `${left}${' '.repeat(spaces)}${right}`;
    }

    private wrap(text: string, maxWidth: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let current = '';

        for (const word of words) {
            if (word.length > maxWidth) {
                if (current) { lines.push(current); current = ''; }
                let rest = word;
                while (rest.length > maxWidth) {
                    lines.push(rest.substring(0, maxWidth));
                    rest = rest.substring(maxWidth);
                }
                current = rest;
                continue;
            }
            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length > maxWidth) {
                lines.push(current);
                current = word;
            } else {
                current = candidate;
            }
        }
        if (current) lines.push(current);
        return lines.length ? lines : [''];
    }
}
