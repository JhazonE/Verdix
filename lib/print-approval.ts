import { format } from 'date-fns';

export interface ApprovalItem {
  id: string;
  transaction_type: string;
  transaction_data: any;
  status: 'Pending' | 'Approved' | 'Rejected';
  current_step: number;
  created_by: string;
  requester_name: string;
  requester_email: string;
  created_at: string;
  updated_at: string;
  currentStepRole: string;
  currentStepRoleId: string | null;
  history: any[];
  workflow: any[];
}

export const printApproval = (data: ApprovalItem) => {
  const printWindow = window.open('', '', 'height=800,width=800');
  if (!printWindow) return;

  const createdAt = new Date(data.created_at);

  printWindow.document.write('<html><head><title>Transaction Approval Request - ' + data.id.substring(0, 8).toUpperCase() + '</title>');
  printWindow.document.write('<style>');
  printWindow.document.write(`
    @page { size: portrait; margin: 15mm; }
    body { font-family: "Inter", "Segoe UI", Helvetica, Arial, sans-serif; color: #000; line-height: 1.4; font-size: 11pt; margin: 0; padding: 0; }
    
    .document-container { max-width: 800px; margin: 0 auto; padding-bottom: 50px; }
    
    .doc-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
    .company-title { margin: 0; font-size: 20pt; font-weight: 800; text-transform: uppercase; letter-spacing: -0.01em; }
    .doc-type { margin: 0; font-size: 14pt; font-weight: 600; color: #444; }
    
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 25px; }
    .meta-table { width: 100%; border-collapse: collapse; }
    .meta-table td { padding: 4px 0; vertical-align: top; }
    .label { font-weight: 600; font-size: 9pt; color: #555; text-transform: uppercase; width: 130px; }
    .value { font-weight: 500; }
    .id-value { font-family: monospace; font-weight: 700; font-size: 10pt; }

    .section-title { font-size: 10pt; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin: 25px 0 12px 0; letter-spacing: 0.05em; }
    
    .data-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .data-table th { text-align: left; padding: 8px; border-bottom: 1px solid #000; font-size: 9pt; text-transform: uppercase; font-weight: 700; color: #333; }
    .data-table td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
    .data-table tr:last-child td { border-bottom: none; }
    
    .numeric { font-family: "Roboto Mono", monospace; text-align: right; }
    .positive { color: #000; }
    .negative { color: #000; font-weight: 700; }
    
    .summary-box { border: 1px solid #000; padding: 12px; margin-top: 20px; font-size: 10pt; }
    .remarks { font-style: italic; color: #333; margin-top: 5px; }

    .audit-trail { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .audit-trail th { font-size: 8pt; text-transform: uppercase; color: #666; text-align: left; padding: 4px 8px; border-bottom: 1px solid #ddd; }
    .audit-trail td { font-size: 9pt; padding: 6px 8px; border-bottom: 1px solid #f5f5f5; }
    .status-text { font-weight: 700; text-transform: uppercase; font-size: 8pt; }

    .signatures-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 40px; margin-top: 60px; page-break-inside: avoid; }
    .sig-box { border-top: 1px solid #000; text-align: center; padding-top: 8px; font-size: 9pt; font-weight: 700; }
    .sig-label { font-size: 8pt; color: #666; font-weight: 500; margin-top: 2px; }
    .sig-name { font-size: 10pt; min-height: 40px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 5px; }
    
    .footer { position: fixed; bottom: 15mm; left: 15mm; right: 15mm; border-top: 1px solid #eee; padding-top: 10px; font-size: 8pt; color: #999; text-align: center; }

    @media print {
      body { padding: 0; }
      .document-container { width: 100%; }
      .no-print { display: none; }
    }
  `);
  printWindow.document.write('</style></head><body>');

  const formattedType = data.transaction_type.replace(/_/g, ' ');

  printWindow.document.write(`
    <div class="document-container">
      <div class="doc-header">
        <div class="company-info">
          <h1 class="company-title">VENDIX</h1>
        </div>
        <div class="report-title">
          <h2 class="doc-type">TRANSACTION AUTHORIZATION</h2>
        </div>
      </div>

      <div class="meta-grid">
        <table class="meta-table">
          <tr><td class="label">Reference ID</td><td class="value id-value">${data.id.toUpperCase()}</td></tr>
          <tr><td class="label">Transaction</td><td class="value">${formattedType}</td></tr>
          <tr><td class="label">Status</td><td class="value"><span class="status-text">${data.status.toUpperCase()}</span></td></tr>
        </table>
        <table class="meta-table">
          <tr><td class="label">Date Requested</td><td class="value">${format(createdAt, 'yyyy-MM-dd HH:mm')}</td></tr>
          <tr><td class="label">Requester</td><td class="value">${data.requester_name || 'SYSTEM ADMIN'}</td></tr>
          <tr><td class="label">Contact</td><td class="value">${data.requester_email || '-'}</td></tr>
        </table>
      </div>

      <div class="section-title">Record Details</div>
      
      ${data.transaction_type === 'STOCK_ADJUSTMENT' ? `
        <table class="data-table">
          <thead>
            <tr>
              <th width="40%">PRODUCT NAME</th>
              <th>BARCODE</th>
              <th class="numeric">CHANGE</th>
              <th class="numeric">PREV BAL</th>
              <th class="numeric">NEW BAL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${data.transaction_data.productName}</td>
              <td class="id-value">${data.transaction_data.productBarcode || data.transaction_data.productSku || '-'}</td>
              <td class="numeric ${data.transaction_data.quantity > 0 ? 'positive' : 'negative'}">${data.transaction_data.quantity > 0 ? '+' : ''}${data.transaction_data.quantity}</td>
              <td class="numeric">${data.transaction_data.currentStock ?? '-'}</td>
              <td class="numeric">${data.transaction_data.currentStock !== undefined ? (Number(data.transaction_data.currentStock) + Number(data.transaction_data.quantity)) : '-'}</td>
            </tr>
          </tbody>
        </table>
        <div class="remarks"><strong>Reason for Adjustment:</strong> ${data.transaction_data.reason || 'Not documented'}</div>
      ` : ''}

      ${data.transaction_type === 'STOCK_TRANSFER' ? `
        <table class="data-table">
          <thead>
            <tr>
              <th width="40%">PRODUCT / MANIFEST</th>
              <th>SOURCE WAREHOUSE</th>
              <th>TARGET DESTINATION</th>
              <th class="numeric">QUANTITY</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${data.transaction_data.productName || 'Multiple Items'}</td>
              <td>${data.transaction_data.fromWarehouseName || data.transaction_data.sourceWarehouseId}</td>
              <td>${data.transaction_data.toWarehouseName || data.transaction_data.targetWarehouseId}</td>
              <td class="numeric">${data.transaction_data.quantity || '-'}</td>
            </tr>
          </tbody>
        </table>
      ` : ''}

      ${data.transaction_type.toUpperCase() === 'REPACKAGING' ? `
        <table class="data-table">
          <thead>
            <tr>
              <th width="20%">FLOW</th>
              <th width="30%">PRODUCT / DETAILS</th>
              <th>SKU / BARCODE</th>
              <th class="numeric">QTY</th>
              <th class="numeric">UNIT RATE</th>
              <th class="numeric">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="color: #666; font-size: 8pt; font-weight: 700;">[SOURCE] BULK</td>
              <td>
                <div class="font-bold">${data.transaction_data.sourceProductName}</div>
                <div style="font-size: 8pt; color: #666;">Unit: ${data.transaction_data.sourceUnit}</div>
              </td>
              <td class="id-value">${data.transaction_data.items?.[0]?.sku || '-'}${data.transaction_data.items?.[0]?.barcode ? ' / ' + data.transaction_data.items?.[0]?.barcode : ''}</td>
              <td class="numeric negative">-${data.transaction_data.quantityToBreak}</td>
              <td class="numeric">₱${(Number(data.transaction_data.items?.[0]?.cost || data.transaction_data.items?.[0]?.price) || 0).toLocaleString()}</td>
              <td class="numeric">₱${((Number(data.transaction_data.items?.[0]?.cost || data.transaction_data.items?.[0]?.price) || 0) * data.transaction_data.quantityToBreak).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="color: #666; font-size: 8pt; font-weight: 700;">[TARGET] PACK</td>
              <td>
                <div class="font-bold font-primary">${data.transaction_data.targetProductName}</div>
                <div style="font-size: 8pt; color: #666;">Unit: ${data.transaction_data.items?.[1]?.unit || data.transaction_data.newProductData?.unitOfMeasure || '-'}</div>
              </td>
              <td class="id-value">${data.transaction_data.items?.[1]?.sku || '-'}${data.transaction_data.items?.[1]?.barcode ? ' / ' + data.transaction_data.items?.[1]?.barcode : ''}</td>
              <td class="numeric positive">+${(data.transaction_data.quantityToBreak * (data.transaction_data.manualFactor || data.transaction_data.newProductData?.conversionFactor || 1)).toLocaleString()}</td>
              <td class="numeric">₱${(Number(data.transaction_data.items?.[1]?.cost || data.transaction_data.items?.[1]?.price) || 0).toLocaleString()}</td>
              <td class="numeric">₱${((Number(data.transaction_data.items?.[1]?.cost || data.transaction_data.items?.[1]?.price) || 0) * (data.transaction_data.quantityToBreak * (data.transaction_data.manualFactor || data.transaction_data.newProductData?.conversionFactor || 1))).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <div class="remarks"><strong>Repackaging Note:</strong> This transaction converts bulk inventory into smaller units.</div>
      ` : ''}

      ${data.transaction_type.toUpperCase() === 'STOCK_COUNT' ? `
        <table class="data-table">
          <thead>
            <tr>
              <th width="40%">PRODUCT / ITEM</th>
              <th>BARCODE</th>
              <th class="numeric">SNAPSHOT</th>
              <th class="numeric">COUNTED</th>
              <th class="numeric">VARIANCE</th>
            </tr>
          </thead>
          <tbody>
            ${data.transaction_data.items.map((it: any) => {
              const snap = Number(it.snapshot_quantity ?? it.snapshotQuantity ?? 0);
              const counted = Number(it.counted_quantity ?? it.countedQuantity ?? 0);
              const variance = counted - snap;
              const pName = it.productName || it.product_name || 'Unknown Item';
              const pBarcode = it.productBarcode || it.productSku || it.product_sku || 'N/A';

              return `
              <tr>
                <td>${pName}</td>
                <td class="id-value">${pBarcode}</td>
                <td class="numeric">${snap}</td>
                <td class="numeric">${counted}</td>
                <td class="numeric ${variance > 0 ? 'positive' : variance < 0 ? 'negative' : ''}">${variance > 0 ? '+' : ''}${variance}</td>
              </tr>
            `}).join('')}
          </tbody>
        </table>
      ` : ''}

      ${data.transaction_type.toUpperCase() === 'RECEIVE_PO' ? `
        <div class="summary-box" style="margin-bottom: 20px;">
          <strong>Supplier:</strong> ${data.transaction_data.supplierName || 'N/A'}<br>
          <strong>PO Reference:</strong> ${data.transaction_data.referenceNumber || data.id}
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th width="40%">PRODUCT NAME</th>
              <th>BARCODE</th>
              <th class="numeric">QTY</th>
              <th class="numeric">COST</th>
              <th class="numeric">SUBTOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${(data.transaction_data.receivedItems || []).map((it: any) => `
              <tr>
                <td>${it.productName || it.name || it.productId}</td>
                <td class="id-value">${it.barcode || '-'}</td>
                <td class="numeric font-bold">${it.quantity}</td>
                <td class="numeric">₱${(it.cost || 0).toLocaleString()}</td>
                <td class="numeric font-bold">₱${(it.subtotal || 0).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="text-align: right; font-weight: 700; margin-top: 10px; font-size: 11pt; letter-spacing: -0.02em;">
          RECEIVED TOTAL: ₱${(Number(data.transaction_data.receivedTotal || data.transaction_data.total || data.transaction_data.grandTotal) || 0).toLocaleString()}
        </div>
      ` : ''}

      ${data.transaction_data.items && !['STOCK_COUNT', 'STOCK_TRANSFER', 'STOCK_ADJUSTMENT', 'RECEIVE_PO', 'REPACKAGING'].includes(data.transaction_type.toUpperCase()) ? `
        <table class="data-table">
          <thead>
            <tr>
              <th width="40%">ITEM DESCRIPTION</th>
              <th class="numeric">QTY</th>
              <th class="numeric">UNIT RATE</th>
              <th class="numeric">EXTENDED</th>
            </tr>
          </thead>
          <tbody>
            ${data.transaction_data.items.map((it: any) => `
              <tr>
                <td>${it.productName || it.name}</td>
                <td class="numeric">${it.quantity}</td>
                <td class="numeric">${it.cost ? it.cost.toLocaleString() : it.price ? it.price.toLocaleString() : '-'}</td>
                <td class="numeric">${(it.cost || it.price) ? ((it.cost || it.price) * it.quantity).toLocaleString() : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <div style="text-align: right; font-weight: 700; margin-top: 10px;">
          GRAND TOTAL: ₱${(Number(data.transaction_data.total || data.transaction_data.grandTotal || data.transaction_data.total_amount) || 0).toLocaleString()}
        </div>
      ` : ''}

      ${data.transaction_data.items && ['STOCK_TRANSFER', 'STOCK_ADJUSTMENT'].includes(data.transaction_type.toUpperCase()) ? `
        <table class="data-table">
          <thead>
            <tr>
              <th width="70%">ITEM DESCRIPTION</th>
              <th class="numeric">QTY</th>
            </tr>
          </thead>
          <tbody>
            ${data.transaction_data.items.map((it: any) => `
              <tr>
                <td>${it.productName || it.name}</td>
                <td class="numeric">${it.quantity}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}

      <div class="section-title">Approval Audit Trail</div>
      <table class="audit-trail">
        <thead>
          <tr>
            <th width="10%">STEP</th>
            <th width="20%">LEVEL</th>
            <th width="40%">ACTION / AUTHORIZED BY</th>
            <th width="30%">TIMESTAMP</th>
          </tr>
        </thead>
        <tbody>
          ${data.workflow.map((step, idx) => {
            const historyItem = data.history.find(h => h.step_number === step.step_order);
            const isCurrent = data.status === 'Pending' && data.current_step === step.step_order;
            return `
              <tr>
                <td>${step.step_order}</td>
                <td>${step.role_name}</td>
                <td>
                  ${historyItem ? 
                    `<span class="status-text">${historyItem.action}</span> - ${historyItem.userName || 'Authorized Signature'}` : 
                    isCurrent ? '<em>CURRENTLY PENDING</em>' : '<span style="color: #ccc;">AWAITING PREVIOUS</span>'}
                  ${historyItem?.notes ? `<div style="font-size: 8pt; color: #555; margin-top: 2px;">Note: ${historyItem.notes}</div>` : ''}
                </td>
                <td>${historyItem ? format(new Date(historyItem.created_at), 'yyyy-MM-dd HH:mm') : '-'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <div class="signatures-grid">
        <div class="sig-item">
          <div class="sig-name">${data.requester_name.toUpperCase()}</div>
          <div class="sig-box">PREPARED BY</div>
          <div class="sig-label">Requester Signature</div>
        </div>
        ${data.workflow.map(step => {
          const approver = data.history.find(h => h.step_number === step.step_order && h.action === 'Approved');
          return `
            <div class="sig-item">
              <div class="sig-name">${approver ? approver.userName.toUpperCase() : ''}</div>
              <div class="sig-box">${step.role_name.toUpperCase()}</div>
              <div class="sig-label">Authorized Signature / Date</div>
            </div>
          `;
        }).join('')}
      </div>

    </div>

    <div class="footer">
      OFFICIAL DOCUMENT - verdix ERP SYSTEM - REF: ${data.id}<br>
      Printed: ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')} (EST)
    </div>
  `);

  printWindow.document.write('</body></html>');
  printWindow.document.close();
  
  setTimeout(() => {
    printWindow.print();
  }, 500);
};
