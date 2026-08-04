
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { format } from 'date-fns';
import { XReadingData } from './types';

const W = 32;

export class XReadingGenerator {
    private encoder: any;

    constructor() {
        this.encoder = new ReceiptPrinterEncoder({
            language: 'esc-pos',
            codepageMapping: 'epson',
            width: W
        });
    }

    public generate(data: XReadingData): Uint8Array {
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
            overShort,
            minSaleId,
            maxSaleId,
            voidAmount,
            refundAmount,
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
                [
                    { width: 12, align: 'left' },
                    { width: 20, align: 'right' }
                ],
                [
                    ['Report Date:', dateStr],
                    ['Report Time:', timeStr]
                ]
            )

            .newline()
            .table(
                [
                    { width: 15, align: 'left' },
                    { width: 17, align: 'right' }
                ],
                [
                    ['Start Date & Time:', shiftStart ? format(new Date(shiftStart), 'MM/dd/yy h:mm a') : '-'],
                    ['End Date & Time:', shiftEnd ? format(new Date(shiftEnd), 'MM/dd/yy h:mm a') : 'Active']
                ]
            )
            .newline()
            .table(
                [
                    { width: 10, align: 'left' },
                    { width: 22, align: 'right' }
                ],
                [
                    ['Cashier:', cashierName]
                ]
            )
            .newline()
            .table(
                 [
                    { width: 12, align: 'left' },
                    { width: 20, align: 'right' }
                ],
                [
                    ['Beg. OR #:', minSaleId || '000000'],
                    ['End. OR #:', maxSaleId || '000000']
                ]
            )
            .newline()
            .table(
                 [
                    { width: 15, align: 'left' },
                    { width: 17, align: 'right' }
                ],
                [
                    ['Opening Fund:', formatCurrency(startingCash)]
                ]
            )
            .line('--------------------------------') // ~32 chars for 58mm
            
            // PAYMENTS RECEIVED
            .line('PAYMENTS RECEIVED')
            .table(
                [
                    { width: 20, align: 'left' },
                    { width: 12, align: 'right' }
                ],
                paymentMethods.map(pm => [pm.name.toUpperCase(), formatCurrency(pm.amount)])
            )
            .table(
                 [
                    { width: 20, align: 'left' },
                    { width: 12, align: 'right' }
                ],
                [
                     ['Total Payments:', formatCurrency(paymentMethods.reduce((acc, m) => acc + m.amount, 0))]
                ]
            )
            .line('--------------------------------')

            // VOID
            .table(
                 [
                    { width: 20, align: 'left' },
                    { width: 12, align: 'right' }
                ],
                [['VOID', formatCurrency(voidAmount || 0)]]
            )
            .line('--------------------------------')

            // REFUND
             .table(
                 [
                    { width: 20, align: 'left' },
                    { width: 12, align: 'right' }
                ],
                [['REFUND', formatCurrency(refundAmount || 0)]]
            )
            .line('--------------------------------')

            // WITHDRAWAL
             .table(
                 [
                    { width: 20, align: 'left' },
                    { width: 12, align: 'right' }
                ],
                [['WITHDRAWAL', formatCurrency(cashPickup || 0)]]
            )
            .line('--------------------------------')

            // TRANSACTION SUMMARY
            .line('TRANSACTION SUMMARY')
            .table(
                [
                     { width: 20, align: 'left' },
                     { width: 12, align: 'right' }
                ],
                [
                    ['Cash In Drawer:', formatCurrency(cashInDrawer)],
                    ...paymentMethods.filter(p => p.name !== 'CASH').map(pm => [pm.name.toUpperCase(), formatCurrency(pm.amount)]),
                    ...((membershipCash || 0) > 0 ? [
                        ['Membership (cash):', formatCurrency(membershipCash || 0)],
                        [`  ${membershipActivationCount || 0}a / ${membershipRenewalCount || 0}r`, '']
                    ] : []),
                    ['Opening Fund:', formatCurrency(startingCash)],
                    ['Less Withdrawal:', formatCurrency(cashPickup || 0)],
                    ['Payments Received:', formatCurrency(paymentMethods.reduce((acc, m) => acc + m.amount, 0))]
                ]
            )
             .line('--------------------------------')

             // CASH DENOMINATIONS
             .line('CASH DENOMINATIONS')
             .table(
                 [
                     { width: 20, align: 'left' },
                     { width: 12, align: 'right' }
                 ],
                 (cashDenominations || []).map(d => [
                     `${d.qty} x ${d.amount >= 1 ? d.amount : d.amount.toFixed(2)}`,
                     formatCurrency(d.total)
                 ])
             );
        
        if (!cashDenominations || cashDenominations.length === 0) {
            enc.line('No denomination data');
        }

        enc
             .line('--------------------------------')
             .table(
                 [
                     { width: 20, align: 'left' },
                     { width: 12, align: 'right' }
                 ],
                 [['SHORT/OVER:', formatShortOver(overShort || 0)]]
             )
             .line('--------------------------------')
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
