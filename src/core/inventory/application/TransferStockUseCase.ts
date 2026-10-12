import { InventoryTransferRepository } from '../domain/IInventoryTransferRepository';
import { InventoryTransferEntity } from '../domain/InventoryTransfer';
import { TransferStockService } from '../../../infrastructure/services/TransferStockService';

export interface TransferStockRequest {
  sourceWarehouseId: string;
  targetWarehouseId: string;
  transferDate: string;
  reference?: string;
  notes?: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitOfMeasure?: string;
  }>;
}

export class TransferStockUseCase {
  constructor(
    private transferRepository: InventoryTransferRepository,
    private transferService: TransferStockService
  ) {}

  async execute(request: any): Promise<string> {
    const transferId = `trf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Sanitize source/target warehouse IDs (handle aliases)
    const sourceWarehouseId = request.sourceWarehouseId || request.fromWarehouseId;
    const targetWarehouseId = request.targetWarehouseId || request.toWarehouseId;

    if (!sourceWarehouseId || !targetWarehouseId) {
      throw new Error('Source and Target warehouse IDs are required for transfer');
    }

    // Sanitize transferDate for MySQL compatibility
    let transferDate = request.transferDate || new Date().toISOString();
    if (transferDate.includes('T')) {
      transferDate = transferDate.slice(0, 19).replace('T', ' ');
    }

    // The single-product transfer dialog (and approval-queue rows created from it)
    // send a flat { productId, quantity } payload; bulk transfers send items[].
    const items: TransferStockRequest['items'] = Array.isArray(request.items)
      ? request.items
      : request.productId
        ? [{
            productId: request.productId,
            productName: request.productName || 'Unknown',
            quantity: request.quantity,
            unitOfMeasure: request.unitOfMeasure,
          }]
        : [];

    if (items.length === 0) {
      throw new Error('Transfer requires at least one item');
    }

    const transferEntity: InventoryTransferEntity = {
      id: transferId,
      sourceWarehouseId,
      targetWarehouseId,
      transferDate,
      reference: request.reference,
      status: 'Completed', // For now, auto-completing
      notes: request.notes,
      items: items.map((item, index) => ({
        id: `${transferId}_item_${index + 1}`,
        transferId: transferId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure
      }))
    };

    await this.transferRepository.saveWithTransaction(transferEntity, async (connection) => {
      for (const item of items) {
        await this.transferService.syncFamilyStockDuringTransfer(
          transferId,
          item.productId,
          targetWarehouseId,
          item.quantity,
          request.notes,
          connection
        );
      }
    });

    return transferId;
  }
}
