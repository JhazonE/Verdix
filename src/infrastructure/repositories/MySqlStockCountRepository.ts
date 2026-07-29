import { query, withTransaction } from '../../../lib/mysql';
import { StockCountRepository } from '../../core/inventory/domain/IStockCountRepository';
import { StockCountEntity, StockCountItemEntity } from '../../core/inventory/domain/StockCount';
import { PoolConnection } from 'mysql2/promise';

export class MySqlStockCountRepository implements StockCountRepository {
  async findAll(): Promise<StockCountEntity[]> {
    const countsQuery = `
      SELECT sc.id, sc.name, sc.status, sc.notes, sc.warehouse_id as warehouseId, sc.shelf_location_id as shelfLocationId,
             sc.created_by as createdBy, sc.completed_by as completedBy, sc.completed_at as completedAt,
             sc.snapshot_at as snapshotAt,
             sc.created_at as createdAt, sc.updated_at as updatedAt,
             w.name as warehouseName, sl.name as shelfName
      FROM stock_counts sc
      LEFT JOIN warehouses w ON sc.warehouse_id = w.id
      LEFT JOIN shelf_locations sl ON sc.shelf_location_id = sl.id
      ORDER BY sc.created_at DESC
    `;
    const countsRaw: any[] = await query(countsQuery);
    
    if (countsRaw.length === 0) return [];

    const countIds = countsRaw.map(c => c.id);
    const placeholders = countIds.map(() => '?').join(',');
    
    const itemsQuery = `
      SELECT sci.id, sci.stock_count_id as stockCountId, sci.product_id as productId,
             sci.snapshot_quantity as snapshotQuantity, sci.counted_quantity as countedQuantity,
             sci.counted_at as countedAt,
             sci.variance, sci.created_at as createdAt, sci.updated_at as updatedAt,
             p.name as productName, p.sku, p.barcode
      FROM stock_count_items sci
      JOIN products p ON sci.product_id = p.id
      WHERE sci.stock_count_id IN (${placeholders})
    `;
    const itemsRaw: any[] = await query(itemsQuery, countIds);
    
    // 3. Fetch all involved shelf names for each count
    const shelfNamesQuery = `
      SELECT DISTINCT sci.stock_count_id as stockCountId, sl.name as shelfName
      FROM stock_count_items sci
      JOIN products p ON sci.product_id = p.id
      JOIN shelf_locations sl ON p.shelf_location_id = sl.id
      WHERE sci.stock_count_id IN (${placeholders})
    `;
    const shelfNamesRaw: any[] = await query(shelfNamesQuery, countIds);

    const shelfNamesByCount: Record<string, string[]> = {};
    shelfNamesRaw.forEach(row => {
      if (!shelfNamesByCount[row.stockCountId]) {
        shelfNamesByCount[row.stockCountId] = [];
      }
      shelfNamesByCount[row.stockCountId].push(row.shelfName);
    });

    const itemsByCount: Record<string, StockCountItemEntity[]> = {};
    itemsRaw.forEach(item => {
      if (!itemsByCount[item.stockCountId]) {
        itemsByCount[item.stockCountId] = [];
      }
      itemsByCount[item.stockCountId].push({
        ...item,
        snapshotQuantity: parseFloat(item.snapshotQuantity || 0),
        countedQuantity: item.countedQuantity !== null ? parseFloat(item.countedQuantity) : undefined,
        productName: item.productName,
        sku: item.sku,
        barcode: item.barcode
      });
    });

    return countsRaw.map(c => ({
      ...c,
      items: itemsByCount[c.id] || [],
      shelfNames: shelfNamesByCount[c.id] || []
    }));
  }

  async findById(id: string): Promise<StockCountEntity | null> {
    const all = await this.findAll();
    return all.find(c => c.id === id) || null;
  }

  async create(stockCount: StockCountEntity): Promise<string> {
     return await withTransaction(async (connection) => {
        const sql = `
            INSERT INTO stock_counts (id, name, warehouse_id, shelf_location_id, status, notes, created_by, snapshot_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
        `;
        await connection.query(sql, [
            stockCount.id,
            stockCount.name,
            stockCount.warehouseId || null,
            stockCount.shelfLocationId || null,
            stockCount.status,
            stockCount.notes || null,
            stockCount.createdBy || 'Admin'
        ]);

        if (stockCount.items && stockCount.items.length > 0) {
          const itemSql = `
              INSERT INTO stock_count_items (id, stock_count_id, product_id, snapshot_quantity, counted_quantity, variance, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
          `;
          for (const item of stockCount.items) {
              await connection.query(itemSql, [
                  item.id, 
                  stockCount.id, 
                  item.productId, 
                  item.snapshotQuantity, 
                  item.countedQuantity || null, 
                  item.variance || null
              ]);
          }
        }
        return stockCount.id;
     });
  }

  async update(id: string, stockCount: Partial<StockCountEntity>): Promise<void> {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (stockCount.status) {
      updates.push('status = ?');
      params.push(stockCount.status);
    }
    if (stockCount.notes !== undefined) {
      updates.push('notes = ?');
      params.push(stockCount.notes);
    }

    if (updates.length > 0) {
      const sql = `UPDATE stock_counts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
      params.push(id);
      await query(sql, params);
    }
  }

  async saveWithTransaction(stockCountId: string, operations: (connection: PoolConnection) => Promise<void>): Promise<void> {
    await withTransaction(async (connection) => {
      await operations(connection);
    });
  }
}
