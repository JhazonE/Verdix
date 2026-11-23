import { PurchaseOrder, Product, BusinessProfile } from "@/lib/types";
import { format } from "date-fns";
import { calculatePurchaseCosts } from "@/lib/purchase-utils";
import { formatQuantity } from "@/lib/utils";

export function printPurchaseOrder(
  order: PurchaseOrder,
  profile: BusinessProfile | null,
  products: Product[]
) {
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (!printWindow) {
    alert("Please allow popups to print.");
    return;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Purchase Order #${order.referenceNumber || order.id.substring(0,8)}</title>
      <style>
        @page { size: A4 portrait; margin: 15mm; }
        body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; padding: 0; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h1 { margin: 0; font-size: 18pt; font-weight: bold; }
        .header p { margin: 0; font-size: 10pt; }
        
        .info-row { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 10pt; }
        .info-col p { margin: 2px 0; }
        
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 9pt; }
        th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
        th { background-color: #f0f0f0; -webkit-print-color-adjust: exact; font-weight: bold; }
        .text-right { text-align: right; }
        
        .totals { margin-left: auto; width: 200px; font-size: 10pt; }
        .totals-row { display: flex; justify-content: space-between; padding: 2px 0; }
        .totals-row.bordered { border-bottom: 1px dashed #999; }
        .totals-row.final { border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 4px; }
        .totals-row.grand { font-weight: bold; font-size: 11pt; }
        
        .footer { margin-top: 50px; display: flex; justify-content: space-between; font-size: 10pt; }
        .signature-box { text-align: center; width: 200px; }
        .signature-line { border-top: 1px solid #000; padding-top: 5px; }
        
        .generated { margin-top: 30px; text-align: center; font-size: 8pt; color: #666; }
      </style>
    </head>
    <body>
      <div class="header">
          <h1>PURCHASE ORDER</h1>
          <p>${profile?.businessName || 'verdix Inc.'}</p>
          <p style="font-size: 8pt; margin-top: 2px;">${profile?.address || '123 Business Avenue, Tech District'}</p>
          <p style="font-size: 8pt;">${profile?.contactNumber || '+63 900 000 0000'} • ${profile?.email || 'contact@verdix.app'}</p>
      </div>
      
      <div class="info-row">
          <div class="info-col">
              <p><strong>Supplier:</strong></p>
              <p>${order.supplierName}</p>
              <p>ID: ${order.supplierId?.substring(0,8)}</p>
          </div>
          <div class="info-col" style="text-align: right;">
              <p><strong>PO #:</strong> ${order.referenceNumber || order.id.substring(0, 8).toUpperCase()}</p>
              <p><strong>Date:</strong> ${format(new Date(order.date), "MMM dd, yyyy")}</p>
              <p><strong>Status:</strong> ${order.status}</p>
          </div>
      </div>
      
      <table>
          <thead>
              <tr>
                  <th style="width: 30%">Description</th>
                  <th class="text-right" style="width: 10%">Rem. Qty</th>
                  <th class="text-right" style="width: 10%">Cost</th>
                  <th class="text-right" style="width: 10%">Qty</th>
                  <th class="text-right" style="width: 12%">Landed Cost</th>
                  <th class="text-right" style="width: 13%">Total</th>
                  <th class="text-right" style="width: 10%">Selling Price</th>
                  <th class="text-right" style="width: 10%">Recv</th>
              </tr>
          </thead>
          <tbody>
              ${order.items.map((item, index) => {
                  const product = products.find(p => p.id === item.productId);
                  const currentStock = product ? product.stock : (item.currentStock || 0);
                  
                  return `
                  <tr>
                      <td>
                          <div style="font-weight: bold; font-size: 10pt;">${item.productName}</div>
                          <div style="font-size: 8pt; color: #666;">
                              ${item.barcode || '-'}
                          </div>
                      </td>
                       <td class="text-right">${formatQuantity(currentStock)}</td>
                      <td class="text-right">₱${(Number(item.cost) || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      <td class="text-right">${formatQuantity(item.quantity)}</td>
                      <td class="text-right" style="color: #666; font-style: italic;">₱${(() => {
                          const results = calculatePurchaseCosts(order.items as any, order.shippingFee || 0);
                          return (results.items[index]?.landedCostPerUnit || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                      })()}</td>
                      <td class="text-right">₱${((Number(item.cost) || 0) * (Number(item.quantity) || 0)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                      <td class="text-right">${Number(item.sellingPrice) > 0 ? '₱' + Number(item.sellingPrice).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}</td>
                      <td class="text-right">${
                          order.status === 'Received' || order.status === 'Paid' ? formatQuantity(item.quantity) : 
                          (order.status === 'Approved' ? '0' : '-')
                      }</td>
                  </tr>
              `}).join('')}
          </tbody>
      </table>
      
      <div class="totals">
          <div class="totals-row bordered">
              <span>Subtotal:</span>
              <span>₱${order.items.reduce((acc, item) => acc + (Number(item.cost) || 0) * (Number(item.quantity) || 0), 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div class="totals-row bordered">
              <span>Shipping:</span>
              <span>₱${(Number(order.shippingFee) || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
           <div class="totals-row final">
              <span>VAT:</span>
              <span>₱${(Number(order.vatAmount) || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
           <div class="totals-row grand">
              <span>Total:</span>
              <span>₱${(Number(order.total) || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
      </div>
      
      <div class="footer">
          <div class="signature-box">
              <div class="signature-line">Authorized By</div>
          </div>
           <div class="signature-box">
              <div class="signature-line">Received By</div>
          </div>
      </div>
      
      <div class="generated">Generated by verdix on ${format(new Date(), "PPpp")}</div>
      
      <script>
          window.onload = function() { window.print(); window.close(); }
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
}
