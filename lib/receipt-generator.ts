import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format, addYears } from 'date-fns';
import type { POSSaleItem, Customer } from './types';
import { SystemSettings } from './types';
import { formatSINumber } from './si-number';
import { resolveEffectiveTaxType } from './tax-utils';

// Default for 58mm
const DEFAULT_COLS = 32;

// ESC p m t1 t2 — cash drawer kick on connector pin 2, 25ms on / 250ms off.
// Emitted inside the receipt byte stream so it reaches the drawer through every
// transport (native spooler, serial, USB, Epson SDK) rather than only the Epson path.
export const DRAWER_KICK = [0x1b, 0x70, 0x00, 0x19, 0xfa];

/**
 * A sale kicks the drawer only when cash actually changes hands, including one leg of a
 * split tender. Reprints and duplicate copies re-render a past sale, so they never kick.
 */
export function saleOpensDrawer(sale: {
    paymentMethod?: string;
    payments?: { method: string }[];
    isReprint?: boolean;
}): boolean {
    if (sale.isReprint) return false;
    const isCash = (method?: string) => method?.trim().toUpperCase() === 'CASH';
    if (isCash(sale.paymentMethod)) return true;
    return (sale.payments ?? []).some(p => isCash(p.method));
}

export class ReceiptGenerator {
    private encoder: any;

    constructor() { }

    /** Kick bytes on their own, for a cash sale where the cashier declined the receipt. */
    public generateDrawerKick(): Uint8Array {
        return new Uint8Array(DRAWER_KICK);
    }

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

    public generateReceipt(sale: {
        items: POSSaleItem[];
        customer: Customer | null;
        totalDue: number;
        change: number;
        paymentMethod: string;
        orderNumber?: string;
        siNumber?: string;
        birOrNumber?: string;
        amountTendered?: number;
        pointsEarned?: number;
        pointsUsedCount?: number;
        transactionDate?: Date;
        cashierName?: string;
        terminalMin?: string;
        terminalSerialNumber?: string;
        terminalPermitNo?: string;
        terminalAccreditationNo?: string;
        terminalPermitDateIssued?: string;
        isTrainingMode?: boolean;
        pointsUsedValue?: number;
        pointsBalance?: number;
        paymentReference?: string;
        payments?: { method: string; amount: number; reference?: string }[];
        terminalName?: string;
        isReprint?: boolean;
        taxBreakdown?: {
            vatableSales: number;
            vatAmount: number;
            vatExemptSales: number;
            zeroRatedSales: number;
            nonVatSales: number;
        };
    }, settings?: SystemSettings | null): Uint8Array {

        const { COLS, QTY_W, AMT_W, NAME_W } = this.getLayout(settings);
        const { items, customer, totalDue, change, paymentMethod, orderNumber, amountTendered, pointsEarned, pointsUsedCount } = sale;
        const subTotal      = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
        const totalDiscount = items.reduce((acc, item) => acc + (item.discount || 0), 0); // Recent-sales passes total amount
        
        // Calculate tax breakdown if not provided
        let taxBreakdown = sale.taxBreakdown;
        if (!taxBreakdown) {
            let vatableSales = 0;
            let vatAmount = 0;
            let vatExemptSales = 0;
            let zeroRatedSales = 0;
            let nonVatSales = 0;

            items.forEach(item => {
                const lineTotal = (item.price * item.quantity) - (item.discount || 0);
                const baseTaxType = (item as any).taxType || item.taxType || (item as any).product?.taxType || 'VAT';
                const taxType = resolveEffectiveTaxType(baseTaxType, (item as any).discountType, item.discount);

                if (taxType === 'VAT') {
                    const vatable = lineTotal / 1.12;
                    vatableSales += vatable;
                    vatAmount += (lineTotal - vatable);
                } else if (taxType === 'VAT_EXEMPT') {
                    vatExemptSales += lineTotal;
                } else if (taxType === 'ZERO_RATED') {
                    zeroRatedSales += lineTotal;
                } else if (taxType === 'NON_VAT') {
                    nonVatSales += lineTotal;
                } else {
                    // Default to VAT if unknown
                    const vatable = lineTotal / 1.12;
                    vatableSales += vatable;
                    vatAmount += (lineTotal - vatable);
                }
            });

            taxBreakdown = {
                vatableSales,
                vatAmount,
                vatExemptSales,
                zeroRatedSales,
                nonVatSales
            };
        }

        const currentDate   = sale.transactionDate ? new Date(sale.transactionDate) : new Date();
        const dateStr       = format(currentDate, 'PP p');

        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: COLS,
        });

        const enc = this.encoder.initialize().codepage('cp437');

        // Kick first so the drawer opens while the paper is still feeding.
        if (saleOpensDrawer(sale)) enc.raw(DRAWER_KICK);

        // ─── HEADER (centered) ───────────────────────────────────────────


        const bizName = settings?.businessName?.trim() || 'VENDIX';
        const address = settings?.address?.trim() || 'General Merchandise';
        const minNumber = sale.terminalMin || settings?.minNumber || '1234567890';
        const serialNumber = sale.terminalSerialNumber || settings?.serialNumber || '0987654321-11';
        
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(bizName);
        enc.line(address);

        const tinLabel = settings?.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN';
        if (settings?.contactNumber) enc.line(settings.contactNumber);
        if (settings?.tin)           enc.line(`${tinLabel}: ${settings.tin}`);
        enc.line(`MIN: ${minNumber}`);
        enc.line(`S/N: ${serialNumber}`);
        const accreditationNo = sale.terminalAccreditationNo;
        const permitNo        = sale.terminalPermitNo;
        if (accreditationNo) enc.line(`ACCR NO: ${accreditationNo}`);
        if (permitNo)         enc.line(`PTU NO: ${permitNo}`);
        enc.line(dateStr);
        enc.raw([0x1b, 0x61, 0x30]); // Native Left
        enc.newline();

        // ─── SALE HEADER ───────────────────────────────────────────
        // Goods → Sales Invoice (si_number); services → Official Receipt
        // (birOrNumber). No cash/charge distinction in the title on either
        // side — payment method remains visible in the payment-section line
        // below. Exactly one of siNumber/birOrNumber is set per sale.
        const isServicesReceipt = !!sale.birOrNumber;
        const title = isServicesReceipt ? 'OFFICIAL RECEIPT' : 'SALES INVOICE';
        enc.raw([0x1b, 0x61, 0x31]).line(title).raw([0x1b, 0x61, 0x30]);
        if (isServicesReceipt) {
            enc.bold(true).line(`OR NO.: ${sale.birOrNumber}`).bold(false);
        } else {
            // orderNumber is a per-terminal counter, not a BIR series — only a fallback
            // for rows written before si_number existed.
            const formattedSiNo = formatSINumber(sale.siNumber || orderNumber);
            enc.bold(true).line(`SI NO.: ${formattedSiNo}`).bold(false);
        }
        if (sale.isReprint) {
            enc.raw([0x1b, 0x61, 0x31]); // Native Center
            enc.bold(true).line('*** REPRINT ***').bold(false);
            enc.line(`Reprinted: ${format(new Date(), 'PP p')}`);
            enc.raw([0x1b, 0x61, 0x30]); // Native Left
        }
        enc.line(`Cust: ${customer?.name || 'Walk-in'}`);
        enc.line(`Cashier: ${sale.cashierName || 'Admin'}`);
        if (sale.terminalName) {
            enc.line(`Terminal: ${sale.terminalName}`);
        }
        enc.line('-'.repeat(COLS)); // dashed border

        // ─── ITEM TABLE HEADER ────────────────────────────────────────────
        const pad = ' '; 
        const hdrQty  = 'Qty'.padEnd(QTY_W, pad);
        const hdrName = 'Item'.padEnd(NAME_W, pad);
        const hdrAmt  = 'Amt'.padStart(AMT_W, pad);
        enc.bold(true).line(`${hdrQty}${hdrName}${hdrAmt}`).bold(false);
        enc.rule({ style: 'single' });

        // Calculate absolute position dots: QTY_W characters * 12 dots per character width = 84 dots
        // For ESC/POS absolute position (ESC $ nL nH), distance is (nL + nH * 256) dots.
        // 84 dots = 84 % 256 = 84 for nL, 0 for nH
        const marginLeftDots = QTY_W * 12; 
        const nl = marginLeftDots % 256;
        const nh = Math.floor(marginLeftDots / 256);

        // Define a helper method for left padding an indented line using explicit raw bytes
        // ESC $ nL nH
        // 0x1B, 0x24, nL, nH
        const absoluteIndent = () => {
             enc.raw([0x1b, 0x24, nl, nh]);
        };

        // ─── ITEMS ────────────────────────────────────────────────────────
        items.forEach(item => {
            const uomAbbr = this.abbreviateUOM((item as any).unitOfMeasure);
            const qtyText = `${item.quantity}${uomAbbr ? ' ' + uomAbbr : ''}`;
            
            const qty     = qtyText.length > QTY_W ? qtyText.substring(0, QTY_W) : qtyText.padEnd(QTY_W, pad);

            const amtText = this.fmt(item.price * item.quantity);
            const amt     = amtText.length > AMT_W ? amtText.substring(0, AMT_W) : amtText.padStart(AMT_W, pad);

            // Word-wrap item name into NAME_W-char chunks
            const chunks  = this.wrap(item.name.trim(), NAME_W);
            
            const padName = (s: string) => s.length >= NAME_W ? s.substring(0, NAME_W) : s.padEnd(NAME_W, pad);

            // First line: qty | name[0] | amt -> Length guaranteed to be EXACTLY 32.
            enc.line(`${qty}${padName(chunks[0] || '')}${amt}`);

            // Remaining name lines (NO RIGHT PADDING AT ALL! Just left coords and text)
            for (let i = 1; i < chunks.length; i++) {
                absoluteIndent();
                enc.line(chunks[i]);
            }

            // Discount line
            if (item.discount && item.discount > 0) {
                const discText = `Disc: ${item.discount}%`;
                absoluteIndent();
                enc.line(discText);
            }

            // Unit price line
            const unitPriceText = `@ ${this.fmt(item.price)}`;
            absoluteIndent();
            enc.line(unitPriceText);
        });

        // ─── TOTALS (dashed top border) ───────────────────────────────────
        enc.line('-'.repeat(COLS));

        const padRow = (left: string, right: string, width: number = COLS) => {
            const spaces = width - left.length - right.length;
            if (spaces <= 0) return `${left} ${right}`.substring(0, width);
            return `${left}${pad.repeat(spaces)}${right}`;
        };

        enc.line(padRow('SUBTOTAL:', this.fmt(subTotal)));

        if (totalDiscount > 0) {
            enc.line(padRow('Discount:', `-${this.fmt(totalDiscount)}`));
        }

        enc.bold(true).line(padRow('AMOUNT DUE:', this.fmt(totalDue))).bold(false);

        // ─── PAYMENT (solid border above) ────────────────────────────────
        enc.rule({ style: 'single' });

        if (sale.pointsUsedValue && sale.pointsUsedValue > 0) {
            enc.bold(true).line(this.row('Points Redeemed:', `-${this.fmt(sale.pointsUsedValue)}`, COLS)).bold(false);
            enc.bold(true).line(this.row('Net Balance Due:', this.fmt(totalDue - sale.pointsUsedValue), COLS)).bold(false);
        }

        if (sale.payments && sale.payments.length > 0) {
             sale.payments.forEach(p => {
                 const lbl = p.method.toUpperCase() === 'CASH' ? 'CASH:' : `${p.method}:`;
                 enc.bold(true).line(this.row(lbl, this.fmt(p.amount), COLS)).bold(false);
                 if (p.reference) {
                     enc.line(this.row('REF NO:', p.reference, COLS));
                 }
             });
        } else {
             if (sale.pointsUsedValue && sale.pointsUsedValue > 0) {
                 enc.bold(true).line(this.row('CASH Tendered:', this.fmt(amountTendered || (totalDue + change)), COLS)).bold(false);
             } else {
                 const cashLabel = paymentMethod?.toUpperCase() === 'CASH' ? 'CASH:' : `${paymentMethod}:`;
                 enc.bold(true).line(this.row(cashLabel, this.fmt(amountTendered || (totalDue + change)), COLS)).bold(false);
             }
             if (sale.paymentReference) {
                 enc.line(this.row('REF NO:', sale.paymentReference, COLS));
             }
        }

        if (change > 0) {
            enc.bold(true).line(this.row('CHANGE:', this.fmt(change), COLS)).bold(false);
        }

        // ─── STATUTORY DISCOUNT HOLDER (SC/PWD/NAAC/Solo Parent) ──────────
        // Required on the OR for BIR compliance.
        const statutoryLabels: Record<string, string> = {
            senior: 'SENIOR CITIZEN',
            pwd: 'PWD',
            naac: 'NAAC',
            solo_parent: 'SOLO PARENT',
        };
        const discountHolderItem = items.find(item => item.discountIdNumber || item.discountHolderName);
        if (discountHolderItem && (discountHolderItem.discountIdNumber || discountHolderItem.discountHolderName)) {
            const discTypeLabel = discountHolderItem.discountType ? statutoryLabels[discountHolderItem.discountType] : undefined;
            enc.line('-'.repeat(COLS));
            enc.raw([0x1b, 0x61, 0x31]).line(discTypeLabel ? `${discTypeLabel} DISCOUNT` : 'DISCOUNT DETAILS').raw([0x1b, 0x61, 0x30]);
            enc.line(`NAME: ${discountHolderItem.discountHolderName || ''}`);
            enc.line(`ID NO.: ${discountHolderItem.discountIdNumber || ''}`);
            enc.line('SIGNATURE: ____________');
        }

        // ─── TAX BREAKDOWN (dashed border above) ─────────────────────────
        if (taxBreakdown) {
            enc.line('-'.repeat(COLS));
            enc.line(padRow('VAT SALES', this.fmt(taxBreakdown.vatableSales)));
            enc.line(padRow('12% VAT', this.fmt(taxBreakdown.vatAmount)));
            enc.line(padRow('VAT-EXEMPT SALES', this.fmt(taxBreakdown.vatExemptSales)));
            enc.line(padRow('ZERO-RATED SALES', this.fmt(taxBreakdown.zeroRatedSales)));
            enc.line(padRow('NON-VAT SALES', this.fmt(taxBreakdown.nonVatSales)));
        }

        // ─── POINTS (dashed border above, if any) ────────────────────────
        if ((pointsEarned && pointsEarned > 0) || (sale.pointsUsedCount && sale.pointsUsedCount > 0) || (sale.pointsBalance !== undefined)) {
            enc.line('-'.repeat(COLS));
            enc.raw([0x1b, 0x61, 0x31]).line('LOYALTY STATEMENT').raw([0x1b, 0x61, 0x30]);
            
            if (sale.pointsUsedCount && sale.pointsUsedCount > 0) {
                enc.line(this.row('Points Used:', `${sale.pointsUsedCount.toLocaleString()} pts`, COLS));
            }
            if (pointsEarned && pointsEarned > 0) {
                enc.line(this.row('Points Earned:', `${pointsEarned.toLocaleString()} pts`, COLS));
            }
            if (sale.pointsBalance !== undefined) {
                enc.bold(true).line(this.row('New Balance:', `${Number(sale.pointsBalance).toLocaleString()} pts`, COLS)).bold(false);
            } else if (customer) {
                const balance = (customer as any).current_points || (customer as any).loyaltyPoints || 0;
                enc.bold(true).line(this.row('New Balance:', `${Number(balance).toLocaleString()} pts`, COLS)).bold(false);
            }
        }

        // ─── FOOTER (centered) ────────────────────────────────────────────
        // Matches: text-center mt-6
        enc.newline();
        enc.align('center');
        if (!sale.isTrainingMode) {
            if (permitNo) {
                const validUntil = sale.terminalPermitDateIssued
                    ? format(addYears(new Date(sale.terminalPermitDateIssued), 5), 'MM/dd/yyyy')
                    : null;
                enc.line(validUntil
                    ? `This invoice/receipt shall be valid for five (5) years from the date of the permit to use (until ${validUntil}).`
                    : 'This invoice/receipt shall be valid for five (5) years from the date of the permit to use.');
            }
            if (settings?.vatRegistration === 'NON_VAT') {
                enc.line('THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.');
            }
            enc.line('ASK FOR RECEIPT!');
        }
        enc.line(`Shop smart, save more! Thank you for visiting ${bizName}.`);
        if (sale.isTrainingMode) {
            enc.newline();
            enc.line('THIS IS NOT A SALES INVOICE');
            enc.line('RECEIPT.');
            enc.line('PLEASE REQUEST FROM SELLER');
            enc.line('YOUR SALES INVOICE/');
            enc.line('OFFICIAL RECEIPT');
        }

        enc.newline().newline().newline();
        enc.cut();

        return enc.encode();
    }

    public generatePaymentReceipt(payment: {
        customerName: string;
        date: Date | string;
        amount: number;
        paymentMethod: string;
        reference?: string;
        note?: string;
        invoiceNo?: string;
    }, settings?: any): Uint8Array {
        const { COLS } = this.getLayout(settings);
        const W = COLS;
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: COLS,
        });
        const enc = this.encoder.initialize().codepage('cp437');

        const center = (text: string) => {
            const t = text.substring(0, W);
            const padLen = Math.max(0, Math.floor((W - t.length) / 2));
            return ' '.repeat(padLen) + t;
        };

        const padRow = (left: string, right: string) => {
            const spaces = W - left.length - right.length;
            if (spaces <= 0) return `${left} ${right}`.substring(0, W);
            return `${left}${' '.repeat(spaces)}${right}`;
        };

        const paymentDate = new Date(payment.date);
        const dateStr = format(paymentDate, 'PP p');
        const bizName = settings?.businessName?.trim() || 'VENDIX';
        const address = settings?.address?.trim() || 'General Merchandise';
        const minNumber = settings?.minNumber || '';
        const serialNumber = settings?.serialNumber || '';

        // HEADER
        const tinLabel = settings?.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN';
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(bizName);
        enc.line(address);
        if (settings?.contactNumber) enc.line(settings.contactNumber);
        if (settings?.tin)           enc.line(`${tinLabel}: ${settings.tin}`);
        enc.line(`MIN: ${minNumber}`);
        enc.line(`S/N: ${serialNumber}`);
        enc.line(dateStr);
        enc.raw([0x1b, 0x61, 0x30]); // Native Left
        enc.newline();

        // TITLE
        enc.raw([0x1b, 0x61, 0x31]).line('PAYMENT RECEIPT').raw([0x1b, 0x61, 0x30]);
        enc.line('-'.repeat(W));

        // DETAILS
        enc.line(`Received From: ${payment.customerName.substring(0, W - 15)}`);
        // Keep the full reference so it matches the payment history; only trim if it
        // would overflow the paper width (label is 12 chars + 1 space separator).
        const refMax = Math.max(8, W - 13);
        if (payment.invoiceNo) enc.line(padRow('Invoice Ref:', payment.invoiceNo.substring(0, refMax)));
        if (payment.reference) enc.line(padRow('Receipt Ref:', payment.reference.substring(0, refMax)));
        enc.line(padRow('Method:', payment.paymentMethod));
        if (payment.note) enc.line(`Note: ${payment.note.substring(0, W - 6)}`);
        enc.line('-'.repeat(W));

        // AMOUNT
        enc.raw([0x1b, 0x61, 0x31]).line('AMOUNT PAID');
        enc.raw([0x1b, 0x61, 0x31]).line(`P${this.fmt(payment.amount)}`);
        enc.raw([0x1b, 0x61, 0x30]); // Native Left

        // FOOTER
        enc.newline();
        enc.align('center');
        enc.line('Thank you for your payment!');
        enc.line('This is a system generated receipt.');
        enc.newline().newline().newline();
        enc.cut();

        return enc.encode();
    }

    public generateMembershipReceipt(data: {
        customerName: string;
        rfidCode: string | null;
        amount: number;
        paymentMethod: string;
        amountTendered?: number;
        change?: number;
        newExpiry: string;
        previousExpiry?: string | null;
        isNewCard: boolean;
        receiptNumber: string;
        cashierName?: string;
        transactionDate?: Date;
    }, settings?: SystemSettings | null): Uint8Array {
        const { COLS } = this.getLayout(settings);
        const W = COLS;
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: W,
        });
        const enc = this.encoder.initialize().codepage('cp437');

        const padRow = (left: string, right: string) => {
            const spaces = W - left.length - right.length;
            if (spaces <= 0) return `${left} ${right}`.substring(0, W);
            return `${left}${' '.repeat(spaces)}${right}`;
        };

        const currentDate = data.transactionDate ? new Date(data.transactionDate) : new Date();
        const dateStr = format(currentDate, 'PP p');
        const bizName = settings?.businessName?.trim() || 'VENDIX';
        const address = settings?.address?.trim() || 'General Merchandise';

        // HEADER (store block, reused from the sale receipt — but NO MIN/SN/SI)
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(bizName);
        enc.line(address);
        if (settings?.contactNumber) enc.line(settings.contactNumber);
        enc.line(dateStr);
        enc.raw([0x1b, 0x61, 0x30]); // Native Left
        enc.newline();

        // TITLE — explicitly not a BIR document. The type (activation vs renewal)
        // is promoted here in bold so the cashier and customer see it at a glance.
        enc.raw([0x1b, 0x61, 0x31]);
        enc.bold(true).line(data.isNewCard ? 'MEMBERSHIP ACTIVATION' : 'MEMBERSHIP RENEWAL').bold(false);
        enc.line('Acknowledgment Receipt');
        enc.line('(Not a BIR Sales Invoice)');
        enc.raw([0x1b, 0x61, 0x30]);
        enc.line('-'.repeat(W));

        // DETAILS
        enc.line(padRow('Receipt No:', data.receiptNumber.substring(0, Math.max(8, W - 12))));
        enc.line(padRow('Cashier:', (data.cashierName || 'Admin').substring(0, Math.max(4, W - 9))));
        enc.line(`Customer: ${data.customerName.substring(0, W - 10)}`);
        enc.line(padRow('RFID:', (data.rfidCode || '-').substring(0, Math.max(4, W - 6))));
        enc.line('-'.repeat(W));

        // AMOUNT
        enc.bold(true).line(padRow('Amount:', `P${this.fmt(data.amount)}`)).bold(false);
        enc.line(padRow('Method:', data.paymentMethod.toUpperCase()));
        if (data.paymentMethod?.toLowerCase() === 'cash' && data.amountTendered != null) {
            enc.line(padRow('Tendered:', `P${this.fmt(data.amountTendered)}`));
            enc.line(padRow('Change:', `P${this.fmt(data.change ?? Math.max(0, data.amountTendered - data.amount))}`));
        }
        enc.line('-'.repeat(W));

        // VALIDITY
        enc.bold(true).line(padRow('Valid Until:', data.newExpiry)).bold(false);

        // FOOTER
        enc.newline();
        enc.align('center');
        enc.line('Thank you for your membership!');
        enc.line('This is a system generated receipt.');
        enc.newline().newline().newline();
        enc.cut();

        return enc.encode();
    }

    public generateZReadingReceipt(data: any, settings?: any): Uint8Array {
        const { COLS } = this.getLayout(settings);
        const W = COLS;

        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: W,
        });
        const enc = this.encoder.initialize().codepage('cp437');

        const center = (text: string) => {
            const t = text.substring(0, W);
            const pad = Math.max(0, Math.floor((W - t.length) / 2));
            return ' '.repeat(pad) + t;
        };

        const row = (left: string, right: string) => {
            const spaces = W - left.length - right.length;
            if (spaces <= 0) return (left + ' ' + right).substring(0, W);
            return left + ' '.repeat(spaces) + right;
        };

        const fmt = (n: number) =>
            n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const dash = '-'.repeat(W);

        const stripLead = (val: string | number | undefined) => {
            const str = String(val || '0');
            if (/^0+$/.test(str)) return '0';
            return str.replace(/^0+/, '') || '0';
        };

        // Use settings from API exactly as-is (no forced uppercase)
        const bizName = settings?.businessName || "NICOLE'S SUPERMARKET";
        const address = settings?.address || 'Paniqui, Tarlac';
        const tin = settings?.tin || '123-456-789-00000';
        const minNumber = data.terminalMin || settings?.minNumber || '1234567890';
        const serialNumber = data.terminalSerialNumber || settings?.serialNumber || '0987654321-11';

        // ── HEADER ──────────────────────────────────────────────────────────
        // Mirrors: headerDiv > headerTitle (center, bold)
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(bizName);
        if (settings?.operatedBy) enc.line(`Operated by: ${settings.operatedBy}`);
        enc.line(address);
        enc.line(`${settings?.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN'}: ${tin}`);
        if (settings?.contactNumber) enc.line(`Contact: ${settings.contactNumber}`);
        if (settings?.email) enc.line(settings.email);
        enc.line(`MIN: ${minNumber}`)
           .line(`S/N: ${serialNumber}`);
        if (data.terminalName) enc.line(`Terminal: ${data.terminalName}`);
        enc.raw([0x1b, 0x61, 0x30]); // Native Left

        // ── TITLE ────────────────────────────────────────────────────────────
        // Mirrors: sectionTitle (center, bold, marginTop:5px)
        enc.raw([0x1b, 0x61, 0x31]).line('Z-READING REPORT').raw([0x1b, 0x61, 0x30]);

        // ── DATE SECTION ─────────────────────────────────────────────────────
        // Mirrors: section { marginBottom: 2px } with rows
        const reportDate = data.reportDate ? new Date(data.reportDate) : new Date();
        const startTime  = new Date(reportDate);
        startTime.setHours(9, 0, 0, 0);

        enc.line(row('Report Date:', format(reportDate, 'MMMM d, yyyy')));
        enc.line(row('Report Time:', format(reportDate, 'h:mm a')));
        enc.line(row('Start:', format(startTime, 'MM/dd/yy h:mm a')));
        enc.line(row('End:',   format(reportDate, 'MM/dd/yy h:mm a')));

        // ── COUNTER SECTION ──────────────────────────────────────────────────
        // Mirrors: second section block (no separator from date section, just margin)
        enc.line(row('Beg. SI #:',        stripLead(data.minSaleId)));
        enc.line(row('End. SI #:',        stripLead(data.maxSaleId)));
        enc.line(row('Beg. OR #:',        stripLead(data.minSaleOrId || 'OR-000000')));
        enc.line(row('End. OR #:',        stripLead(data.maxSaleOrId || 'OR-000000')));
        enc.line(row('Beg. VOID #:',      stripLead(data.minVoidId)));
        enc.line(row('End. VOID #:',      stripLead(data.maxVoidId)));
        enc.line(row('Beg. VOID OR #:',   stripLead(data.minVoidOrId || 'OR-000000')));
        enc.line(row('End. VOID OR #:',   stripLead(data.maxVoidOrId || 'OR-000000')));
        enc.line(row('Beg. RETURN #:',    stripLead(data.minReturnId || '0')));
        enc.line(row('End. RETURN #:',    stripLead(data.maxReturnId || '0')));
        enc.line(row('Beg. RETURN OR #:', stripLead(data.minReturnOrId || 'OR-000000')));
        enc.line(row('End. RETURN OR #:', stripLead(data.maxReturnOrId || 'OR-000000')));
        enc.line(row('Reset Counter No.', stripLead(data.resetCounter)));
        enc.line(row('Z Counter No. :',   stripLead(data.zCounter)));

        // ── SALES TOTALS ─────────────────────────────────────────────────────
        // Mirrors: DashedLine + section
        enc.line(dash);
        enc.line(row('Present Sales:',     fmt(data.netSales || 0)));
        enc.line(row('Previous Sales:',    fmt(data.previousReading || 0)));
        enc.bold(true).line(row('Sales for the Day:', fmt(data.netSales || 0))).bold(false);

        // ── BREAKDOWN OF SALES ───────────────────────────────────────────────
        // Mirrors: DashedLine + sectionTitle + section
        enc.line(dash);
        enc.align('center').bold(true).line('BREAKDOWN OF SALES').bold(false).align('left');
        enc.line(row('VATABLE SALES :',   fmt(data.vatSales  || 0)));
        enc.line(row('VAT AMOUNT:',       fmt(data.vatAmount || 0)));
        enc.line(row('VAT EXEMPT SALES:', fmt(data.vatExempt || 0)));
        enc.line(row('ZERO RATED SALES:', fmt(data.zeroRated || 0)));

        // ── GROSS → NET ──────────────────────────────────────────────────────
        // Mirrors: DashedLine + section
        enc.line(dash);
        enc.line(row('Gross Amount:',        fmt(data.grossSales    || 0)));
        enc.line(row('Less Discount:',       fmt(data.discounts     || 0)));
        enc.line(row('Less Return:',         fmt(data.returns       || 0)));
        enc.line(row('Less Void:',           fmt(data.voidAmount    || 0)));
        enc.line(row('Less VAT Adjustment:', fmt(data.vatAdjustment || 0)));
        enc.bold(true).line(row('Net Amount:', fmt(data.netSales || 0))).bold(false);

        // ── DISCOUNT SUMMARY ─────────────────────────────────────────────────
        // Mirrors: DashedLine + sectionTitle + section
        enc.line(dash);
        enc.align('center').bold(true).line('DISCOUNT SUMMARY').bold(false).align('left');
        const zDiscountSummary: Array<{ type: string; amount: number }> = data.discountSummary || [];
        let scDiscAmt = 0, pwdDiscAmt = 0, naacDiscAmt = 0, soloDiscAmt = 0, otherDiscAmt = 0;
        zDiscountSummary.forEach((d) => {
            const type = d.type?.toLowerCase();
            if (type === 'senior') scDiscAmt += d.amount;
            else if (type === 'pwd') pwdDiscAmt += d.amount;
            else if (type === 'naac') naacDiscAmt += d.amount;
            else if (type === 'solo_parent') soloDiscAmt += d.amount;
            else otherDiscAmt += d.amount;
        });
        enc.line(row('SC Disc. :',          fmt(scDiscAmt)));
        enc.line(row('PWD Disc. :',         fmt(pwdDiscAmt)));
        enc.line(row('NAAC Disc. :',        fmt(naacDiscAmt)));
        enc.line(row('Solo Parent Disc. :', fmt(soloDiscAmt)));
        enc.line(row('Other Disc. :',       fmt(otherDiscAmt)));

        // ── SALES ADJUSTMENT ─────────────────────────────────────────────────
        // Mirrors: DashedLine + sectionTitle + section
        enc.line(dash);
        enc.align('center').bold(true).line('SALES ADJUSTMENT').bold(false).align('left');
        enc.line(row('VOID :',   fmt(data.voidAmount || 0)));
        enc.line(row('RETURN :', fmt(data.returns || 0)));

        // ── VAT ADJUSTMENT ───────────────────────────────────────────────────
        // Mirrors: DashedLine + sectionTitle + section
        enc.line(dash);
        enc.align('center').bold(true).line('VAT ADJUSTMENT').bold(false).align('left');
        enc.line(row('SC TRANS. :',           '0.00'));
        enc.line(row('PWD TRANS :',           '0.00'));
        enc.line(row('REG.Disc. TRANS :',     '0.00'));
        enc.line(row('ZERO-RATED TRANS.:',    '0.00'));
        enc.line(row('VAT on Return:',        '0.00'));
        enc.line(row('Other VAT Adjustments', '0.00'));

        // ── TRANSACTION SUMMARY ──────────────────────────────────────────────
        // Mirrors: DashedLine + sectionTitle + section
        enc.line(dash);
        enc.align('center').bold(true).line('TRANSACTION SUMMARY').bold(false).align('left');
        (data.paymentMethods || []).forEach((method: any) => {
            enc.line(row(`${method.name.toUpperCase()}:`, fmt(method.amount || 0)));
        });
        if ((data.membershipCash || 0) > 0) {
          enc.line(row('Membership Fees (cash):', fmt(data.membershipCash || 0)));
        }
        enc.line(row('Opening Fund:',    fmt(data.startingCash || 0)));
        enc.line(row('Less Withdrawal:', '0.00'));
        const totalPayments = (data.paymentMethods || [])
            .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
        enc.bold(true).line(row('Payments Received:', fmt(totalPayments))).bold(false);

        // ── SHORT/OVER ───────────────────────────────────────────────────────
        // Mirrors: DashedLine + section + DashedLine
        enc.line(dash);
        enc.line(row('SHORT/OVER:', '0.00'));
        enc.line(dash);

        // ── FOOTER ───────────────────────────────────────────────────────────
        // Mirrors: footer (center, 10px text) + THIS IS NOT...
        enc.newline();
        enc.align('center');
        enc.line('This Receipt shall be valid for');
        enc.line('five (5) years from the date of');
        enc.line('the permit to use.');
        enc.newline();
        enc.bold(true).line('THIS IS NOT AN OFFICIAL RECEIPT').bold(false);

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

    /** Format number as currency string */
    private fmt(amount: number): string {
        return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Create a left+right padded row that fills `width` characters */
    private row(left: string, right: string, width: number = DEFAULT_COLS): string {
        const spaces = width - left.length - right.length;
        if (spaces <= 0) return `${left} ${right}`.substring(0, width);
        return `${left}${' '.repeat(spaces)}${right}`;
    }

    /** Word-wrap `text` into lines of at most `maxWidth` characters */
    private wrap(text: string, maxWidth: number): string[] {
        const words  = text.split(' ');
        const lines: string[] = [];
        let   current = '';

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
