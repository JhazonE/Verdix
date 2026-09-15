import { StockCountRepository } from '../domain/IStockCountRepository';
import { PoolConnection } from 'mysql2/promise';
import { updateStockAndRecordMovement } from '../../../../lib/stock-movements';
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
      // Keep it that way even though a variance now touches only its own product.
      // Reading all baselines up front makes every line's baseline a snapshot of
      // the same instant, which is what the count measured; interleaving reads
      // and writes would let one line's own write bleed into another's inputs if
      // the same product ever appears twice in a count. Historically this
      // mattered far more: applying a variance ran family-sync, which rewrote the
      // stock of every OTHER member of that product's family, so a later line in
      // the same family read a live stock that already included that write while
      // its movement sums excluded it (they filter out this count's own reference
      // id) — inventing a phantom variance on a correctly counted line.
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

        if (usedFallback) {
          console.warn(
            `[StockCount] Movement log incomplete for product ${item.productId} in count ${stockCountId}: ` +
            `snapshot ${item.snapshotQuantity} + net movements ${m.netMovementToNow} since ${snapshotAt?.toISOString() ?? 'unknown'} ` +
            `should equal live stock but got ${m.liveStock} (window checked through ${item.countedAt ?? 'unknown'}). ` +
            `Falling back to live stock as the baseline (${baseline}); counted ${item.countedQuantity} yields variance ${variance}. ` +
            `Check stock_movements for product ${item.productId} in that window for writes that bypassed recordStockMovement.`
          );
        }

        if (variance === 0) continue;

        // The variance was computed against this product's OWN live stock, which
        // is already in base units, so it applies directly and signed. One
        // product, one stock figure — nothing cascades to another product.
        await updateStockAndRecordMovement(
          item.productId,
          variance,
          'adjustment',
          stockCountId,
          'adjustment',
          item.adjustmentReason || 'System Adjustment from Stock Count',
          connection
        );
      }

      // 2. Mark stock count as completed
      await connection.query('UPDATE stock_counts SET status = "completed", completed_at = NOW(), updated_at = NOW() WHERE id = ?', [stockCountId]);
    });
  }
}
