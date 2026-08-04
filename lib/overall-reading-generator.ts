
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format } from 'date-fns';
import { OverallReadingData } from '@/app/(app)/sales/overall-reading/overall-reading-preview';

const W = 32;

export class OverallReadingGenerator {
    private encoder: any;

    constructor() {
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: W
        });
    }

    public generate(data: OverallReadingData): Uint8Array {
        const {
            terminalId,
            terminalName,
            startDate,
            endDate,
            grossSales,
            netSales,
            totalDiscounts,
            transactionCount,
            cashiers,
            businessSettings,
            terminalInfo
        } = data;

        const formatCurrency = (amount: number) => amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        const enc = this.encoder
            .initialize()
            .codepage('cp437');
        
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(businessSettings.businessName.toUpperCase());
        if (businessSettings.address) enc.line(businessSettings.address);
        if (businessSettings.tin) enc.line(`${businessSettings.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN'}: ${businessSettings.tin}`);
        if (terminalInfo.min) enc.line(`MIN: ${terminalInfo.min}`);
        if (terminalInfo.sn) enc.line(`S/N: ${terminalInfo.sn}`);
        if (terminalInfo.permitNo) enc.line(`PTU NO: ${terminalInfo.permitNo}`);
        if (terminalInfo.accreditationNo) enc.line(`ACCR NO: ${terminalInfo.accreditationNo}`);
        enc.line(`Terminal: ${terminalId}`);
        enc.newline()
           .line('OVERALL TERMINAL READING')
           .raw([0x1b, 0x61, 0x30]) // Native Left
           .table(
                [
                    { width: 12, align: 'left' },
                    { width: 20, align: 'right' }
                ],
                [
                    ['Report Date:', format(new Date(endDate), 'MM/dd/yy h:mm a')],
                    ['From:', startDate ? format(new Date(startDate), 'MM/dd/yy h:mm a') : 'Creation'],
                    ['To:', format(new Date(endDate), 'MM/dd/yy h:mm a')]
                ]
            )

            .line('--------------------------------')
            .raw([0x1b, 0x61, 0x31]).line('TERMINAL BREAKDOWN').raw([0x1b, 0x61, 0x30])

            .table(
                [
                    { width: 12, align: 'left' },
                    { width: 8, align: 'right' },
                    { width: 12, align: 'right' }
                ],
                [
                    ['TERMINAL', 'TXNS', 'AMOUNT'],
                    ['------------', '----', '----------']
                ]
            );

        data.terminals.forEach(t => {
            enc.table(
                [
                    { width: 12, align: 'left' },
                    { width: 8, align: 'right' },
                    { width: 12, align: 'right' }
                ],
                [[t.terminalName.toUpperCase(), String(t.transactionCount), formatCurrency(t.netSales)]]
            );
        });

        if (data.terminals.length === 0) {
            enc.align('center').line('No terminal data').align('left');
        }

        enc
            .line('--------------------------------')
            .raw([0x1b, 0x61, 0x31]).line('CASHIER BREAKDOWN').raw([0x1b, 0x61, 0x30])
            .table(
                [
                    { width: 12, align: 'left' },
                    { width: 8, align: 'right' },
                    { width: 12, align: 'right' }
                ],
                [
                    ['CASHIER', 'TXNS', 'AMOUNT'],
                    ['------------', '----', '----------']
                ]
            );

        cashiers.forEach(c => {
            enc.table(
                [
                    { width: 12, align: 'left' },
                    { width: 8, align: 'right' },
                    { width: 12, align: 'right' }
                ],
                [[c.cashierName.toUpperCase(), String(c.transactionCount), formatCurrency(c.netSales)]]
            );
        });

        if (cashiers.length === 0) {
            enc.align('center').line('No cashier data').align('left');
        }

        enc
            .line('--------------------------------')
            .newline()
            .align('center')
            .line('End of Overall Reading')
            .newline()
            .bold(true)
            .line('THIS IS NOT AN OFFICIAL RECEIPT')
            .bold(false)
            .newline()
            .cut();

        return enc.encode();
    }
}
