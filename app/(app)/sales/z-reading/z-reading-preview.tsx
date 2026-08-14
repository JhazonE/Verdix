import React from 'react';
import { format } from 'date-fns';

export type ZReadingData = {
  id: string;
  date: string;
  reportDate: Date;
  grossSales: number;
  returns: number;
  discounts: number;
  netSales: number;
  vatSales: number;
  vatAmount: number;
  vatExempt: number;
  zeroRated: number;
  nonVat: number;
  paymentMethods: Array<{ name: string; amount: number }>;
  transactionCount: number;
  startingCash: number;
  cashSales: number;
  cashInDrawer: number;
  membershipCash?: number;
  membershipActivationCount?: number;
  membershipRenewalCount?: number;
  cashierName?: string;
  terminalId?: string;
  terminalMin?: string;
  terminalSerialNumber?: string;
  minSaleId?: string;
  maxSaleId?: string;
  minVoidId?: string;
  maxVoidId?: string;
  minReturnId?: string;
  maxReturnId?: string;
  minSaleOrId?: string;
  maxSaleOrId?: string;
  minVoidOrId?: string;
  maxVoidOrId?: string;
  minReturnOrId?: string;
  maxReturnOrId?: string;
  previousReading?: number;
  runningTotal?: number;
  voidAmount?: number;
  vatAdjustment?: number;
  zCounter?: number;
  resetCounter?: number;
  terminalName?: string;
  intervalStartDate?: string | Date;
  discountSummary?: Array<{ type: string; amount: number; count: number; itemCount?: number }>;
  salesAdjustment?: {
    void: { count: number; amount: number };
    return: { count: number; amount: number };
  };
  cashierBreakdown?: Array<{ userId: string; cashierName: string; shiftCount: number; transactionCount: number; salesTotal: number }>;
};


type PrinterFormat = '58mm' | '80mm';


export type BusinessSettings = {
  businessName: string;
  address: string;
  contactNumber: string;
  tin: string;
  vatRegistration?: 'VAT' | 'NON_VAT';
  logoPath?: string;
  operatedBy?: string;
  minNumber?: string;
  serialNumber?: string;
  email?: string;
  paperSize?: '58mm' | '80mm';
};

interface ZReadingPreviewProps {
  data: ZReadingData;
  printerFormat: PrinterFormat;
  businessSettings: BusinessSettings | null;
}

export const ZReadingPreview = React.forwardRef<HTMLDivElement, ZReadingPreviewProps>(({ data, printerFormat, businessSettings }, ref) => {
  const is58mm = printerFormat === '58mm';
  // Helper for dashed line
  const DashedLine = () => (
    <div style={{ width: '100%', borderTop: '1px dashed black', margin: '5px 0' }} />
  );

  const formatCurrency = (amount: number) => 
    amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const reportDate = new Date(data.reportDate);
  const startTime = data.intervalStartDate ? new Date(data.intervalStartDate) : new Date(data.reportDate);
  if (!data.intervalStartDate) {
    startTime.setHours(9, 0, 0, 0); // Fallback to 9 AM only if intervalStartDate is missing
  }
  
  const minSi = data.minSaleId || '000000';
  const maxSi = data.maxSaleId || '000000';
  const minVoid = data.minVoidId || '000000';
  const maxVoid = data.maxVoidId || '000000';
  const minReturn = data.minReturnId || '000000';
  const maxReturn = data.maxReturnId || '000000';
  const minSiOr = data.minSaleOrId || 'OR-000000';
  const maxSiOr = data.maxSaleOrId || 'OR-000000';
  const minVoidOr = data.minVoidOrId || 'OR-000000';
  const maxVoidOr = data.maxVoidOrId || 'OR-000000';
  const minReturnOr = data.minReturnOrId || 'OR-000000';
  const maxReturnOr = data.maxReturnOrId || 'OR-000000';

  const styles = {
    container: {
        width: is58mm ? '58mm' : '80mm',
        minWidth: is58mm ? '58mm' : '80mm',
        maxWidth: is58mm ? '58mm' : '80mm',
        margin: '0 auto', 
        backgroundColor: 'white',
        color: 'black',
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: is58mm ? '9px' : '11px', 
        lineHeight: '1.2',
        padding: '1mm 2mm',
        fontWeight: 'normal',
        wordBreak: 'break-word' as const,
    },
    headerDiv: {
        textAlign: 'center' as const,
        marginBottom: '2px', // Tight header
        fontWeight: 'bold',
    },
    headerTitle: {
        fontSize: '14px',
        textTransform: 'uppercase' as const,
        marginBottom: '2px',
    },
    sectionTitle: {
        textAlign: 'center' as const,
        marginTop: '5px',
        marginBottom: '2px',
        fontWeight: 'bold',
        fontSize: '12px',
        textTransform: 'uppercase' as const,
    },
    row: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '2px', 
    },
    section: {
        marginBottom: '2px',
    },
    bold: {
        fontWeight: 'bold',
    },
    footer: {
        marginTop: '10px',
        marginBottom: '10px',
        textAlign: 'center' as const,
        fontSize: '10px',
    },
    center: {
        textAlign: 'center' as const,
    }
  };

  return (
    <div style={styles.container} ref={ref} className="printable-area">
      {/* Business Header */}
      <div style={styles.headerDiv}>
        <div style={styles.headerTitle}>{businessSettings?.businessName || 'MY BUSINESS'}</div>
        {businessSettings?.operatedBy && (
            <div style={{ fontSize: '10px' }}>Operated by: {businessSettings.operatedBy}</div>
        )}
        <div style={{ fontSize: '10px' }}>{businessSettings?.address || 'Paniqui, Tarlac'}</div>
        <div style={{ fontSize: '10px' }}>{businessSettings?.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN'}: {businessSettings?.tin || '123-456-789-00000'}</div>
        <div style={{ fontSize: '10px' }}>MIN: {data.terminalMin || businessSettings?.minNumber || '1234567890'}</div>
        <div style={{ fontSize: '10px' }}>S/N: {data.terminalSerialNumber || businessSettings?.serialNumber || '0987654321-11'}</div>
        {data.terminalName && <div style={{ fontSize: '10px' }}>Terminal: {data.terminalName}</div>}
      </div>

      <div style={styles.sectionTitle}>
        <div>Z-READING REPORT</div>
      </div>

      {data.id !== 'PREVIEW' && (
        <div style={{ textAlign: 'center' as const }}>
          <div style={{ fontWeight: 'bold' }}>*** REPRINT ***</div>
          <div>Reprinted: {format(new Date(), 'PP p')}</div>
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.row}>
          <span>Report Date:</span>
          <span>{format(reportDate, 'MMMM d, yyyy')}</span>
        </div>
        <div style={styles.row}>
          <span>Report Time:</span>
          <span>{format(reportDate, 'h:mm a')}</span>
        </div>
        <div style={styles.row}>
          <span>Start:</span>
          <span>{format(startTime, 'MM/dd/yy h:mm a')}</span>
        </div>
        <div style={styles.row}>
          <span>End:</span>
          <span>{format(reportDate, 'MM/dd/yy h:mm a')}</span>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <span>Beg. SI #:</span>
          <span>{minSi}</span>
        </div>
        <div style={styles.row}>
          <span>End. SI #:</span>
          <span>{maxSi}</span>
        </div>
        <div style={styles.row}>
          <span>Beg. OR #:</span>
          <span>{minSiOr}</span>
        </div>
        <div style={styles.row}>
          <span>End. OR #:</span>
          <span>{maxSiOr}</span>
        </div>
        <div style={styles.row}>
          <span>Beg. VOID #:</span>
          <span>{minVoid}</span>
        </div>
         <div style={styles.row}>
          <span>End. VOID #:</span>
          <span>{maxVoid}</span>
        </div>
        <div style={styles.row}>
          <span>Beg. VOID OR #:</span>
          <span>{minVoidOr}</span>
        </div>
        <div style={styles.row}>
          <span>End. VOID OR #:</span>
          <span>{maxVoidOr}</span>
        </div>
         <div style={styles.row}>
          <span>Beg. RETURN #:</span>
          <span>{minReturn}</span>
        </div>
         <div style={styles.row}>
          <span>End. RETURN #:</span>
          <span>{maxReturn}</span>
        </div>
        <div style={styles.row}>
          <span>Beg. RETURN OR #:</span>
          <span>{minReturnOr}</span>
        </div>
        <div style={styles.row}>
          <span>End. RETURN OR #:</span>
          <span>{maxReturnOr}</span>
        </div>
         <div style={styles.row}>
          <span>Reset Counter No.</span>
          <span>{data.resetCounter || 0}</span>
        </div>
         <div style={styles.row}>
          <span>Z Counter No. :</span>
          <span>{data.zCounter || 0}</span>
        </div>
      </div>

      <DashedLine />

      <div style={styles.section}>
        <div style={styles.row}>
          <span>Present Sales:</span>
          <span>{formatCurrency(data.netSales)}</span> 
        </div>
         <div style={styles.row}>
          <span>Previous Sales:</span>
          <span>{formatCurrency(data.previousReading || 0)}</span>
        </div>
         <div style={{ ...styles.row, ...styles.bold }}>
          <span>Sales for the Day:</span>
          <span>{formatCurrency(data.netSales)}</span>
        </div>
      </div>

      <DashedLine />

      <div style={styles.sectionTitle}>
        <div>BREAKDOWN OF SALES</div>
      </div>

      <div style={styles.section}>
         <div style={styles.row}>
          <span>VATABLE SALES :</span>
          <span>{formatCurrency(data.vatSales)}</span>
        </div>
         <div style={styles.row}>
          <span>VAT AMOUNT:</span>
          <span>{formatCurrency(data.vatAmount)}</span>
        </div>
         <div style={styles.row}>
          <span>VAT EXEMPT SALES:</span>
          <span>{formatCurrency(data.vatExempt)}</span>
        </div>
         <div style={styles.row}>
          <span>ZERO RATED SALES:</span>
          <span>{formatCurrency(data.zeroRated)}</span>
        </div>
      </div>

      <DashedLine />

      <div style={styles.section}>
         <div style={styles.row}>
          <span>Gross Amount:</span>
          <span>{formatCurrency(data.grossSales)}</span>
        </div>
         <div style={styles.row}>
          <span>Less Discount:</span>
          <span>{formatCurrency(data.discounts)}</span>
        </div>
         <div style={styles.row}>
          <span>Less Return:</span>
          <span>{formatCurrency(data.returns)}</span>
        </div>
         <div style={styles.row}>
          <span>Less Void:</span>
          <span>{formatCurrency(data.voidAmount || 0)}</span>
        </div>
         <div style={styles.row}>
          <span>Less VAT Adjustment:</span>
          <span>{formatCurrency(data.vatAdjustment || 0)}</span>
        </div>
         <div style={{ ...styles.row, ...styles.bold, marginTop: '4px' }}>
          <span>Net Amount:</span>
          <span>{formatCurrency(data.netSales)}</span>
        </div>
      </div>

       <DashedLine />

       <div style={styles.sectionTitle}>
        <div>DISCOUNT SUMMARY</div>
      </div>
      
       <div style={styles.section}>
        {(() => {
          const ds = data.discountSummary || [];
          let scAmt = 0;
          let pwdAmt = 0;
          let naacAmt = 0;
          let soloAmt = 0;
          let otherAmt = 0;

          ds.forEach(d => {
              const type = d.type?.toLowerCase();
              if (type === 'senior') scAmt += d.amount;
              else if (type === 'pwd') pwdAmt += d.amount;
              else if (type === 'naac') naacAmt += d.amount;
              else if (type === 'solo_parent') soloAmt += d.amount;
              else otherAmt += d.amount;
          });

          return (
            <>
              <div style={styles.row}>
                <span>SC Disc. :</span>
                <span>{formatCurrency(scAmt)}</span>
              </div>
              <div style={styles.row}>
                <span>PWD Disc. :</span>
                <span>{formatCurrency(pwdAmt)}</span>
              </div>
              <div style={styles.row}>
                <span>NAAC Disc. :</span>
                <span>{formatCurrency(naacAmt)}</span>
              </div>
              <div style={styles.row}>
                <span>Solo Parent Disc. :</span>
                <span>{formatCurrency(soloAmt)}</span>
              </div>
              <div style={styles.row}>
                <span>Other Disc. :</span>
                <span>{formatCurrency(otherAmt)}</span>
              </div>
            </>
          );
        })()}
      </div>


      <DashedLine />

      {(data.cashierBreakdown && data.cashierBreakdown.length > 0) && (
        <>
          <div style={styles.sectionTitle}>
            <div>BY CASHIER</div>
          </div>

          <div style={styles.section}>
            {data.cashierBreakdown.map(c => (
              <div key={c.userId} style={{ marginBottom: '4px' }}>
                <div style={styles.row}>
                  <span>{c.cashierName}</span>
                  <span>{formatCurrency(c.salesTotal)}</span>
                </div>
                <div style={{ ...styles.row, fontSize: '0.85em', opacity: 0.75 }}>
                  <span>{c.shiftCount} shift{c.shiftCount === 1 ? '' : 's'}, {c.transactionCount} txn{c.transactionCount === 1 ? '' : 's'}</span>
                  <span></span>
                </div>
              </div>
            ))}
          </div>

          <DashedLine />
        </>
      )}

       <div style={styles.sectionTitle}>
        <div>SALES ADJUSTMENT</div>
      </div>

       <div style={styles.section}>
         <div style={styles.row}>
          <span>VOID :</span>
          <span>{formatCurrency(data.salesAdjustment?.void.amount || 0)}</span>
        </div>
         <div style={styles.row}>
          <span>RETURN :</span>
          <span>{formatCurrency(data.salesAdjustment?.return.amount || 0)}</span>
        </div>
      </div>


      <DashedLine />

      <div style={styles.sectionTitle}>
        <div>VAT ADJUSTMENT</div>
      </div>

      <div style={styles.section}>
         <div style={styles.row}>
          <span>VAT ADJ. ON SC/PWD :</span>
          <span>{formatCurrency(data.vatAdjustment || 0)}</span>
        </div>
         <div style={styles.row}>
          <span>VAT ADJ. ON RETURN :</span>
          <span>0.00</span>
        </div>
         <div style={{ ...styles.row, ...styles.bold }}>
          <span>Total VAT Adj. :</span>
          <span>{formatCurrency(data.vatAdjustment || 0)}</span>
        </div>
      </div>


      <DashedLine />

      <div style={styles.sectionTitle}>
        <div>TRANSACTION SUMMARY</div>
      </div>
      
       <div style={styles.section}>
         {(data.paymentMethods || []).map(method => (
             <div key={method.name} style={styles.row}>
              <span style={{ textTransform: 'uppercase' }}>{method.name}:</span>
              <span>{formatCurrency(method.amount)}</span>
            </div>
         ))}
         {(data.membershipCash ?? 0) > 0 && (
           <div style={styles.row}>
             <span>
               Membership Fees (cash):
               {((data.membershipActivationCount ?? 0) + (data.membershipRenewalCount ?? 0)) > 0 && (
                 <span style={{ fontSize: '0.85em', opacity: 0.75 }}>
                   {' '}({data.membershipActivationCount ?? 0} activation, {data.membershipRenewalCount ?? 0} renewal)
                 </span>
               )}
             </span>
             <span>{formatCurrency(data.membershipCash || 0)}</span>
           </div>
         )}

         <div style={styles.row}>
            <span>Opening Fund:</span>
            <span>{formatCurrency(data.startingCash)}</span>
         </div>
          <div style={styles.row}>
            <span>Less Withdrawal:</span>
            <span>0.00</span>
         </div>
          <div style={{ ...styles.row, ...styles.bold, marginTop: '4px' }}>
             <span>Payments Received:</span>
             {/* Total Payments */}
            <span>{formatCurrency((data.paymentMethods || []).reduce((acc, m) => acc + m.amount, 0))}</span>
         </div>
      </div>

      <DashedLine />
      
       <div style={styles.section}>
         <div style={styles.row}>
          <span>SHORT/OVER:</span>
          <span>0.00</span>
        </div>
      </div>

      <DashedLine />
      
      <div style={styles.footer}>
        <div>This Receipt shall be valid for</div>
        <div>five (5) years from the date of</div>
        <div>the permit to use.</div>
      </div>
    
      <div style={{ ...styles.center, ...styles.bold }}>
         <div>THIS IS NOT AN OFFICIAL RECEIPT</div>
      </div>

    </div>
  );
});

ZReadingPreview.displayName = 'ZReadingPreview';
