import { StockCountRepository } from '../domain/IStockCountRepository';
import { PoolConnection } from 'mysql2/promise';
import { findUltimateRoot, addFamilyStock, deductFamilyStock } from '../../../../lib/family-sync';
import { computeTrueVariance, getNetMovementSince } from '../../../../lib/stock-count-baseline';

export class CompleteStockCountUseCase {
  constructor(private stockCountRepository: StockCountRepository) {}

  async execute(stockCountId: string): Promise<void> {
    const stockCount = await this.stockCountRepository.findById(stockCountId);
    if (!stockCount) throw new Error('Stock count not found');
    if (stockCount.status === 'completed') throw new Error('Stock count is already completed');

    await this.stockCountRepository.saveWithTransaction(stockCountId, async (connection: PoolConnection) => {
      const now = new Date();
      const snapshotAt = stockCount.snapshotAt ? new Date(stockCount.snapshotAt) : null;

      // 1. Update each product's stock and record movement
      for (const item of stockCount.items) {
        // Skip uncounted items
        if (item.countedQuantity === undefined || item.countedQuantity === null) continue;

        // Live stock is the arbiter of whether the movement log is complete, and
        // the fallback baseline when it isn't.
        const [stockRows]: any = await connection.query(
          'SELECT stock FROM products WHERE id = ?',
          [item.productId]
        );
        const liveStock = Number(stockRows?.[0]?.stock ?? 0);

        // Without both anchors there is no window to measure, so fall back to the
        // plain snapshot comparison — correct whenever nothing moved.
        let netMovementToCount = 0;
        let netMovementToNow = 0;
        if (snapshotAt && item.countedAt) {
          const countedAt = new Date(item.countedAt);
          netMovementToCount = await getNetMovementSince(
            item.productId, snapshotAt, countedAt, stockCountId, connection
          );
          netMovementToNow = await getNetMovementSince(
            item.productId, snapshotAt, now, stockCountId, connection
          );
        }

        const { variance, usedFallback } = computeTrueVariance({
          snapshotQuantity: item.snapshotQuantity,
          countedQuantity: item.countedQuantity,
          liveStock,
          netMovementToCount,
          netMovementToNow,
        });

        if (usedFallback) {
          console.warn(
            `[StockCount] Movement log incomplete for product ${item.productId} ` +
            `(snapshot ${item.snapshotQuantity} + movements ${netMovementToNow} != live ${liveStock}). ` +
            `Using live stock as the baseline.`
          );
        }

        if (variance === 0) continue;

        // Use family-sync logic to propagate the count adjustment
        const { rootId, factorToRoot } = await findUltimateRoot(item.productId, connection);
        const quantityInRootUnits = Math.abs(variance) / factorToRoot;

        if (variance > 0) {
          await addFamilyStock(
            rootId,
            quantityInRootUnits,
            stockCountId,
            'adjustment',
            item.adjustmentReason || 'System Adjustment from Stock Count',
            connection
          );
        } else {
          await deductFamilyStock(
            rootId,
            quantityInRootUnits,
            stockCountId,
            'adjustment',
            item.adjustmentReason || 'System Adjustment from Stock Count',
            connection
          );
        }
      }

      // 2. Mark stock count as completed
      await connection.query('UPDATE stock_counts SET status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [stockCountId]);
    });
  }
}
