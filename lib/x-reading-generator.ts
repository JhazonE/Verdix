
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format } from 'date-fns';
import { XReadingData } from './types';

// Characters per line: 58mm thermal paper = 32, 80mm = 48 (matches
// ReceiptGenerator.getLayout). Column widths below are written for 32; on
// wider paper the right (value) column keeps its width and the label column
// absorbs the extra space.
const widthFor = (paperSize?: string) => (paperSize === '80mm' ? 48 : 32);

export class XReadingGenerator {
    private encoder: any;

    constructor() {
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: widthFor()
        });
    }

    public generate(data: XReadingData, paperSize?: string): Uint8Array {
        const W = widthFor(paperSize);
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: W
        });
        // Two-column table sized for the current paper width.
        const cols = (_left: number, right: number) => [
            { width: W - right, align: 'left' },
            { width: right, align: 'right' }
        ];
        const dash = '-'.repeat(W);
        const {
            reportDate,
            paymentMethods,
            cashierName,
            shiftStart,
            shiftEnd,
            startingCash,
            cashInDrawer,
            membershipCash,
            membershipActivationCount,
            membershipRenewalCount,
            cashPickup,
            cashDeposit,
            overShort,
            minSaleId,
            maxSaleId,
            minSaleOrId,
            maxSaleOrId,
            voidAmount,
            returns,
            min,
            sn,
            permitNo,
            accreditationNo,
            cashDenominations,
            businessName,
            operatedBy,
            address,
            tin,
            vatRegistration,
            contactNumber,
            email
        } = data;

        const dateStr = format(new Date(reportDate), 'MMMM d, yyyy');
        const timeStr = format(new Date(reportDate), 'h:mm a');
        const formatCurrency = (amount: number) => amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        // Helper to format short/over with sign at end
        const formatShortOver = (val: number) => {
            const absVal = Math.abs(val || 0);
            const sign = (val || 0) >= 0 ? '+' : '-';
            return `${absVal.toFixed(2)}${sign}`;
        };

        const enc = this.encoder
            .initialize()
            .codepage('cp437');
        
        enc.raw([0x1b, 0x61, 0x31]); // Native Center
        enc.line(businessName?.toUpperCase() || 'POS SYSTEM');
        if (operatedBy) enc.line(`Operated by: ${operatedBy}`);
        if (address) enc.line(address);
        if (tin) enc.line(`${vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN'}: ${tin}`);
        if (contactNumber) enc.line(contactNumber);
        if (email) enc.line(email);
        
        enc.line(`MIN: ${min || '0987654321'}`)
           .line(`S/N: ${sn || '1234567890-01'}`);
        if (permitNo)        enc.line(`PTU NO: ${permitNo}`);
        if (accreditationNo) enc.line(`ACCR NO: ${accreditationNo}`);
        if (data.terminalName) enc.line(`Terminal: ${data.terminalName}`);
        enc.newline()
           .line('X-READING REPORT');
        enc.raw([0x1b, 0x61, 0x30]); // Native Left
        enc.newline()
           .align('left')
           .table(
                cols(12, 20),
                [
                    ['Report Date:', dateStr],
                    ['Report Time:', timeStr]
                ]
            )

            .newline()
            .table(
                cols(15, 17),
                [
                    ['Start Date & Time:', shiftStart ? format(new Date(shiftStart), 'MM/dd/yy h:mm a') : '-'],
                    ['End Date & Time:', shiftEnd ? format(new Date(shiftEnd), 'MM/dd/yy h:mm a') : 'Active']
                ]
            )
            .newline()
            .table(
                cols(10, 22),
                [
                    ['Cashier:', cashierName]
                ]
            )
            .newline()
            .table(
                 cols(12, 20),
                [
                    ['Beg. SI #:', minSaleId || '000000'],
                    ['End. SI #:', maxSaleId || '000000'],
                    ['Beg. OR #:', minSaleOrId || 'OR-000000'],
                    ['End. OR #:', maxSaleOrId || 'OR-000000']
                ]
            )
            .newline()
            .table(
                 cols(15, 17),
                [
                    ['Opening Fund:', formatCurrency(startingCash)]
                ]
            )
            .line(dash)
            
            // PAYMENTS RECEIVED
            .line('PAYMENTS RECEIVED')
            .table(
                cols(20, 12),
                paymentMethods.map(pm => [pm.name.toUpperCase(), formatCurrency(pm.amount)])
            )
            .table(
                 cols(20, 12),
                [
                     ['Total Payments:', formatCurrency(paymentMethods.reduce((acc, m) => acc + m.amount, 0))]
                ]
            )
            .line(dash)

            // VOID
            .table(
                 cols(20, 12),
                [['VOID', formatCurrency(voidAmount || 0)]]
            )
            .line(dash)

            // RETURNS (Merchandise Credit) — a return issues a credit slip, not
            // cash from the drawer, so it is reported on its own line and never
            // mixed into cash reconciliation. Printed as a
            // positive magnitude (the stored total is negative); see the ABS()
            // in app/api/sales/x-reading/route.ts.
            .table(
                 cols(20, 12),
                [['RETURNS', formatCurrency(Math.abs(returns || 0))]]
            )
            .line(dash)

            // No REFUND line: this system has no refund feature — nothing ever
            // writes transaction_type = 'refund', so the figure could only ever
            // be 0.00, and Z-reading (the filed report) prints no REFUND line
            // either. A permanently-zero line makes a cashier doubt the report
            // rather than inform them. The refund_amount column and its POST
            // write path are kept, so this is reversible if refunds are built.

            // DEPOSIT / WITHDRAWAL — cash moved in and out of the drawer
            // mid-shift. Both belong here: each one shifts the expected cash
            // the cashier is measured against, so showing only the withdrawal
            // left a deposit silently raising expected cash with no line on
            // the report accounting for where that money came from.
             .table(
                 cols(20, 12),
                [
                    ['DEPOSIT', formatCurrency(cashDeposit || 0)],
                    ['WITHDRAWAL', formatCurrency(cashPickup || 0)]
                ]
            )
            .line(dash)

            // TRANSACTION SUMMARY
            .line('TRANSACTION SUMMARY')
            .table(
                cols(20, 12),
                [
                    ['Cash In Drawer:', formatCurrency(cashInDrawer)],
                    ...paymentMethods.filter(p => p.name !== 'CASH').map(pm => [pm.name.toUpperCase(), formatCurrency(pm.amount)]),
                    ...((membershipCash || 0) > 0 ? [
                        ['Membership (cash):', formatCurrency(membershipCash || 0)],
                        [`  ${membershipActivationCount || 0}a / ${membershipRenewalCount || 0}r`, '']
                    ] : []),
                    ['Opening Fund:', formatCurrency(startingCash)],
                    ['Add Deposit:', formatCurrency(cashDeposit || 0)],
                    ['Less Withdrawal:', formatCurrency(cashPickup || 0)],
                    ['Payments Received:', formatCurrency(paymentMethods.reduce((acc, m) => acc + m.amount, 0))]
                ]
            )
             .line(dash)

             // CASH DENOMINATIONS
             .line('CASH DENOMINATIONS')
             .table(
                 cols(20, 12),
                 (cashDenominations || []).map(d => [
                     `${d.qty} x ${d.amount >= 1 ? d.amount : d.amount.toFixed(2)}`,
                     formatCurrency(d.total)
                 ])
             );
        
        if (!cashDenominations || cashDenominations.length === 0) {
            enc.line('No denomination data');
        }

        enc
             .line(dash)
             .table(
                 cols(20, 12),
                 [['SHORT/OVER:', formatShortOver(overShort || 0)]]
             )
             .line(dash)
             .newline()
             .align('center')
             .line('_______________________')
             .line(`${data.cashierName || 'Cashier'}`)
             .line('(Cashier Signature)')
             .newline()
             .line('_______________________')
             .line('Manager Signature')
             .newline()
             .line('End of X-Reading Report')
             .newline()
             .bold(true)
             .line('THIS IS NOT AN OFFICIAL RECEIPT')
             .bold(false)
             .newline()
             .cut();

        return enc.encode();
    }
}
