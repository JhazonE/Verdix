
import { format } from 'date-fns';
import { BusinessSettings } from '../z-reading/z-reading-preview';

export type XReadingData = {
  id: string;
  date: string;
  reportDate: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  grossSales: number;
  returns: number;
  discounts: number;
  netSales: number;
  vatAmount: number;
  paymentMethods: Array<{ name: string; amount: number }>;
  transactionCount: number;
  startingCash: number;
  cashSales: number;
  cashInDrawer: number;
  membershipCash?: number;
  membershipActivationCount?: number;
  membershipRenewalCount?: number;
  cashierName: string;
  cashierId: string;
  terminalId: string;
  shiftStatus: string;
  // Extended properties
  cashCountId?: string;
  cashDenominations?: Array<{
    amount: number;
    qty: number;
    total: number;
  }>;
  cashDeposit?: number;
  cashPickup?: number;
  cashCountTotal?: number;
  overShort?: number;
  readingNumber?: string;
  minSaleId?: string;
  maxSaleId?: string;
  // BIR OR-series counterpart of minSaleId/maxSaleId (Task 8, mirroring Task
  // 7's ZReadingData fields). Goods (si_number) and services (bir_or_number)
  // are independent BIR numbering sequences, so their ranges are kept separate.
  minSaleOrId?: string;
  maxSaleOrId?: string;
  voidAmount?: number;
  refundAmount?: number;
  min?: string;
  sn?: string;
  terminalName?: string;
};

type PrinterFormat = '58mm' | '80mm';

interface XReadingPreviewProps {
  data: XReadingData;
  printerFormat?: PrinterFormat;
  businessSettings?: BusinessSettings | null;
}

export function XReadingPreview({ data, printerFormat = '58mm', businessSettings }: XReadingPreviewProps) {
  const is58mm = printerFormat === '58mm';
  
  // Helper for dashed line
  const DashedLine = () => (
    <div style={{ width: '100%', borderTop: '1px dashed black', margin: '5px 0' }} />
  );

  const formatCurrency = (amount: number) => 
    amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const styles = {
    container: {
        width: '100%',
        margin: '0', 
        backgroundColor: 'white',
        color: 'black',
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: '11px', 
        lineHeight: '1.2',
        padding: '4mm', // Adjusted for 58mm paper fit
        fontWeight: 'bold',
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
    <div style={styles.container} className="printable-area">
      
      {/* Business Header */}
      <div style={styles.headerDiv}>
        <div style={styles.headerTitle}>{businessSettings?.businessName || 'MY BUSINESS'}</div>
        {businessSettings?.operatedBy && (
            <div style={{ fontSize: '10px' }}>Operated by: {businessSettings.operatedBy}</div>
        )}
        <div style={{ fontSize: '10px' }}>{businessSettings?.address || 'Address'}</div>
        <div style={{ fontSize: '10px' }}>{businessSettings?.vatRegistration === 'NON_VAT' ? 'NON-VAT REG TIN' : 'VAT REG TIN'}: {businessSettings?.tin || '000-000-000-000'}</div>
        <div style={{ fontSize: '10px' }}>MIN: {data.min || '0987654321'}</div>
        <div style={{ fontSize: '10px' }}>S/N: {data.sn || '1234567890-01'}</div>
        {data.terminalName && <div style={{ fontSize: '10px' }}>Terminal: {data.terminalName}</div>}
      </div>

      <div style={styles.sectionTitle}>
        <div>X-READING REPORT</div>
      </div>

      <div style={styles.section}>
        <div style={styles.row}>
          <span>Report Date:</span>
          <span>{format(new Date(), 'MMMM d, yyyy')}</span>
        </div>
        <div style={styles.row}>
          <span>Report Time:</span>
          <span>{format(new Date(), 'h:mm a')}</span>
        </div>
        <div style={styles.row}>
          <span>Start Date & Time:</span>
          <span style={{textAlign: 'right'}}>{data.shiftStart ? format(new Date(data.shiftStart), 'MM/dd/yy h:mm a') : '-'}</span>
        </div>
        <div style={styles.row}>
          <span>End Date & Time:</span>
          <span style={{textAlign: 'right'}}>{data.shiftEnd ? format(new Date(data.shiftEnd), 'MM/dd/yy h:mm a') : 'Active'}</span>
        </div>
        <div style={styles.row}>
            <span>Cashier:</span>
            <span>{data.cashierName}</span>
        </div>
        <div style={styles.row}>
          <span>Beg. SI #:</span>
          <span>{data.minSaleId || '000000'}</span>
        </div>
        <div style={styles.row}>
          <span>End. SI #:</span>
          <span>{data.maxSaleId || '000000'}</span>
        </div>
        <div style={styles.row}>
          <span>Beg. OR #:</span>
          <span>{data.minSaleOrId || 'OR-000000'}</span>
        </div>
        <div style={styles.row}>
          <span>End. OR #:</span>
          <span>{data.maxSaleOrId || 'OR-000000'}</span>
        </div>
        <div style={styles.row}>
            <span>Opening Fund:</span>
            <span>{formatCurrency(data.startingCash)}</span>
        </div>
      </div>

      <DashedLine />

      <div style={styles.sectionTitle}>
         <div>PAYMENTS RECEIVED</div>
      </div>

      <div style={styles.section}>
         {(data.paymentMethods || []).map((method, idx) => (
             <div key={idx} style={styles.row}>
              <span style={{textTransform: 'uppercase'}}>{method.name}</span>
              <span>{formatCurrency(method.amount)}</span>
            </div>
         ))}
         
          <div style={{ ...styles.row, ...styles.bold, marginTop: '2px' }}>
             <span>Total Payments:</span>
            <span>{formatCurrency((data.paymentMethods || []).reduce((acc, m) => acc + m.amount, 0))}</span>
         </div>
      </div>

      <DashedLine />

      <div style={styles.section}>
         <div style={styles.row}>
          <span>VOID</span>
          <span>{formatCurrency(data.voidAmount || 0)}</span>
        </div>
      </div>

       <DashedLine />

       <div style={styles.section}>
         <div style={styles.row}>
          <span>REFUND</span>
          <span>{formatCurrency(data.refundAmount || 0)}</span>
        </div>
      </div>

      <DashedLine />

       <div style={styles.section}>
         <div style={styles.row}>
          <span>WITHDRAWAL</span>
          <span>{formatCurrency(data.cashPickup || 0)}</span>
        </div>
      </div>

      <DashedLine />

      <div style={styles.sectionTitle}>
        <div>TRANSACTION SUMMARY</div>
      </div>
        
      <div style={styles.section}>
        <div style={styles.row}>
           <span>Cash In Drawer:</span>
           <span>{formatCurrency(data.cashInDrawer)}</span>
        </div>

         {(data.paymentMethods || []).filter(p => p.name !== 'CASH').map((method, idx) => (
             <div key={idx} style={styles.row}>
              <span style={{textTransform: 'uppercase'}}>{method.name}</span>
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
           <span>{formatCurrency(data.cashPickup || 0)}</span>
         </div>

         <div style={{ ...styles.row, ...styles.bold, marginTop: '2px' }}>
             <span>Payments Received:</span>
            <span>{formatCurrency((data.paymentMethods || []).reduce((acc, m) => acc + m.amount, 0))}</span>
         </div>
      </div>

      <DashedLine />

      <div style={styles.sectionTitle}>
        <div>CASH DENOMINATIONS</div>
      </div>

       <div style={styles.section}>
         {(data.cashDenominations || []).map((d, i) => (
             <div key={i} style={styles.row}>
                 <span>{d.qty} x {d.amount >= 1 ? d.amount : d.amount.toFixed(2)}</span>
                 <span>{formatCurrency(d.total)}</span>
             </div>
         ))}
         {(!data.cashDenominations || data.cashDenominations.length === 0) && (
             <div style={{ ...styles.center, fontStyle: 'italic', fontSize: '10px' }}>No denomination data</div>
         )}
      </div>

      <DashedLine />
      
       <div style={{ ...styles.section, ...styles.bold }}>
         <div style={styles.row}>
          <span>SHORT/OVER:</span>
          <span>{Math.abs(data.overShort || 0).toFixed(2)}{data.overShort && data.overShort >= 0 ? '+' : '-'}</span>
        </div>
      </div>
      
       <div style={styles.footer}>
        <div style={{marginBottom: '10px'}}>
              _______________________<br/>
              <span style={{fontWeight: 'bold', fontSize: '10px'}}>{data.cashierName.toUpperCase()}</span><br/>
              (Cashier Signature)
         </div>
         <div style={{marginBottom: '10px'}}>
              _______________________<br/>
              <span style={{fontWeight: 'bold', fontSize: '10px'}}>MANAGER</span><br/>
              (Manager Signature)
         </div>
          <div style={{marginTop: '5px', fontStyle: 'italic'}}>End of X-Reading Report</div>
      </div>
    
      <div style={{ ...styles.center, ...styles.bold }}>
         <div>THIS IS NOT AN OFFICIAL RECEIPT</div>
      </div>

    </div>
  );
}
