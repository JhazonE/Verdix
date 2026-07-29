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

      const counted = stockCount.items.filter(
        (i) => i.countedQuantity !== undefined && i.countedQuantity !== null
      );

      // Read every baseline input BEFORE applying any adjustment.
      //
      // This must not move into the loop below. Applying one item's variance runs
      // family-sync, which recursively updates the stock of every OTHER member of
      // that product's family and writes movement rows tagged with this count's
      // id. A later item in the same family would then read a live stock that
      // already includes that write, while its movement sums exclude it (they
      // filter out this count's own reference id) — the reconciliation check
      // would trip on a perfectly healthy log and invent a phantom variance on a
      // correctly counted line. An unfiltered count contains parents and children
      // together, so this is the ordinary case, not an edge case.
      const measured = new Map<string, {
        liveStock: number;
        netMovementToCount: number;
        netMovementToNow: number;
        hasWindow: boolean;
      }>();

      for (const item of counted) {
        const [stockRows]: any = await connection.query(
          'SELECT stock FROM products WHERE id = ?',
          [item.productId]
        );
        const liveStock = Number(stockRows?.[0]?.stock ?? 0);

        const hasWindow = Boolean(snapshotAt && item.countedAt);
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

        measured.set(item.id, { liveStock, netMovementToCount, netMovementToNow, hasWindow });
      }

      // 1. Update each product's stock and record movement
      for (const item of counted) {
        const m = measured.get(item.id)!;

        // No window means no way to tell an intervening movement from a real
        // discrepancy. Comparing against live stock here would silently reverse
        // anything sold after the line was counted, so fall back to the original
        // snapshot comparison instead: wrong only if stock moved during the
        // count, which is the pre-existing behaviour rather than a new failure.
        const { variance, baseline, usedFallback } = m.hasWindow
          ? computeTrueVariance({
              snapshotQuantity: item.snapshotQuantity,
              countedQuantity: item.countedQuantity!,
              liveStock: m.liveStock,
              netMovementToCount: m.netMovementToCount,
              netMovementToNow: m.netMovementToNow,
            })
          : {
              variance: item.countedQuantity! - item.snapshotQuantity,
              baseline: item.snapshotQuantity,
              usedFallback: false,
            };

        if (!m.hasWindow) {
          console.warn(
            `[StockCount] Missing count window for product ${item.productId} in count ${stockCountId} ` +
            `(snapshot_at=${stockCount.snapshotAt ?? 'null'}, counted_at=${item.countedAt ?? 'null'}). ` +
            `Falling back to the plain snapshot comparison; any movement during the count will be ` +
            `mistaken for variance.`
          );
        }

        const liveStock = m.liveStock;
        const netMovementToNow = m.netMovementToNow;

        if (usedFallback) {
          console.warn(
            `[StockCount] Movement log incomplete for product ${item.productId} in count ${stockCountId}: ` +
            `snapshot ${item.snapshotQuantity} + net movements ${netMovementToNow} since ${snapshotAt?.toISOString() ?? 'unknown'} ` +
            `should equal live stock but got ${liveStock} (window checked through ${item.countedAt ?? 'unknown'}). ` +
            `Falling back to live stock as the baseline (${baseline}); counted ${item.countedQuantity} yields variance ${variance}. ` +
            `Check stock_movements for product ${item.productId} in that window for writes that bypassed recordStockMovement.`
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
