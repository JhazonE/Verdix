import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { MySqlInventoryTransferRepository } from '../../../../src/infrastructure/repositories/MySqlInventoryTransferRepository';
import { TransferStockService } from '../../../../src/infrastructure/services/TransferStockService';
import { TransferStockUseCase } from '../../../../src/core/inventory/application/TransferStockUseCase';

// Initialize dependencies
const transferRepository = new MySqlInventoryTransferRepository();
const transferService = new TransferStockService();
const transferStockUseCase = new TransferStockUseCase(transferRepository, transferService);

export async function GET() {
  try {
    const transfers = await transferRepository.findAll();
    return NextResponse.json({
      success: true,
      data: transfers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch transfers' },
      { status: 500 }
    );
  }
}

import { processTransferStock } from '@/lib/transfer-actions';
import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Check if multi-level approval is required
    const isApprovalRequired = await checkApprovalRequired('STOCK_TRANSFER');

    if (isApprovalRequired) {
      // Fetch names for enrichment
      const [productRes, sourceRes, targetRes]: any = await Promise.all([
        query(
          `SELECT p.name, su.barcode as base_unit_barcode, p.barcode
           FROM products p
           LEFT JOIN product_selling_units su ON su.product_id = p.id AND su.is_base = 1
           WHERE p.id = ?`,
          [body.productId],
        ),
        query(`SELECT name FROM warehouses WHERE id = ?`, [body.fromWarehouseId || body.warehouseId || body.sourceWarehouseId]),
        query(`SELECT name FROM warehouses WHERE id = ?`, [body.toWarehouseId || body.targetWarehouseId])
      ]);

      const enrichedData = {
        ...body,
        productName: productRes[0]?.name || 'Unknown Product',
        productBarcode: productRes[0]?.base_unit_barcode || productRes[0]?.barcode || '',
        fromWarehouseName: sourceRes[0]?.name || 'Unknown Warehouse',
        toWarehouseName: targetRes[0]?.name || 'Unknown Warehouse'
      };

      // Use system or user ID if available in body
      const userId = body.userId || 'system';
      const { queueId, pendingApproval } = await submitToApprovalQueue('STOCK_TRANSFER', enrichedData, userId);
      
      if (pendingApproval) {
        return NextResponse.json({ 
          success: true, 
          pendingApproval: true, 
          queueId,
          message: 'Stock transfer submitted for multi-level approval' 
        });
      }
      // If not pending (all steps auto-skipped), fall through to direct execution
    }

    // Direct execution
    const transferPayload = {
      ...body,
      transferDate: body.transferDate || new Date().toISOString().slice(0, 19).replace('T', ' ')
    };
    const result = await processTransferStock(transferPayload);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Inventory transfer processed successfully',
        data: { id: result.transferId },
        timestamp: new Date().toISOString()
      });
    } else {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error processing transfer:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process transfer' },
      { status: 500 }
    );
  }
}
