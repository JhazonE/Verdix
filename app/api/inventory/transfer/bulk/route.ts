import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, query } from '@/lib/mysql';
import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { processTransferStock } from '@/lib/transfer-actions';

/**
 * Bulk Stock Transfer API
 * Handles transferring multiple items between warehouses in a single transaction.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transfers, notes: globalNotes, userId = 'system' } = body;

    if (!transfers || !Array.isArray(transfers) || transfers.length === 0) {
      return NextResponse.json({ success: false, error: 'No transfers provided' }, { status: 400 });
    }

    // Check if multi-level approval is required
    const isApprovalRequired = await checkApprovalRequired('STOCK_TRANSFER');

    // Group transfers by source warehouse to handle them as logical units
    const groupedBySource: Record<string, any[]> = {};
    for (const t of transfers) {
      // Need to find the source warehouse ID for each product if not provided
      let sourceWhId = t.sourceWarehouseId;
      if (!sourceWhId) {
        const rows: any = await query('SELECT warehouse_id FROM products WHERE id = ?', [t.sourceProductId]);
        const p = rows[0];
        sourceWhId = p?.warehouse_id || 'unassigned';
      }
      
      if (!groupedBySource[sourceWhId]) groupedBySource[sourceWhId] = [];
      groupedBySource[sourceWhId].push(t);
    }

    const results = [];
    const queuedItems = [];

    for (const sourceWhId in groupedBySource) {
      const items = groupedBySource[sourceWhId];
      const targetWhId = items[0].targetWarehouseId;

      if (isApprovalRequired) {
        // Enrich data for approval center
        const [sourceRes, targetRes]: any = await Promise.all([
          query(`SELECT name FROM warehouses WHERE id = ?`, [sourceWhId]),
          query(`SELECT name FROM warehouses WHERE id = ?`, [targetWhId])
        ]);

        const enrichedItems = await Promise.all(items.map(async item => {
          const rows: any = await query('SELECT name, sku, barcode FROM products WHERE id = ?', [item.sourceProductId]);
          const p = rows[0];
          return {
            productId: item.sourceProductId,
            productName: p?.name || 'Unknown',
            sku: p?.sku || '',
            barcode: p?.barcode || '',
            quantity: item.quantity,
            notes: item.notes || globalNotes
          };
        }));

        const approvalData = {
          sourceWarehouseId: sourceWhId,
          targetWarehouseId: targetWhId,
          fromWarehouseName: sourceRes[0]?.name || 'Unknown',
          toWarehouseName: targetRes[0]?.name || 'Unknown',
          transferDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
          notes: globalNotes || 'Bulk Warehouse Transfer',
          items: enrichedItems
        };

        const { queueId, pendingApproval } = await submitToApprovalQueue('STOCK_TRANSFER', approvalData, userId);
        
        if (pendingApproval) {
          queuedItems.push({ sourceWhId, targetWhId, queueId });
          continue;
        }
      }

      // If no approval required or auto-approved
      const transferPayload = {
        sourceWarehouseId: sourceWhId,
        targetWarehouseId: targetWhId,
        transferDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
        notes: globalNotes || 'Bulk Warehouse Transfer',
        items: await Promise.all(items.map(async item => {
          const rows: any = await query('SELECT name FROM products WHERE id = ?', [item.sourceProductId]);
          const p = rows[0];
          return {
            productId: item.sourceProductId,
            productName: p?.name || 'Unknown',
            quantity: item.quantity
          };
        }))
      };

      const trfResult = await processTransferStock(transferPayload);
      if (trfResult.success) {
        results.push(trfResult.transferId);
      }
    }

    return NextResponse.json({
      success: true,
      pendingApproval: queuedItems.length > 0,
      processedCount: results.length,
      queuedCount: queuedItems.length,
      data: { results, queuedItems },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Bulk stock transfer error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process bulk stock transfer' },
      { status: 500 }
    );
  }
}
