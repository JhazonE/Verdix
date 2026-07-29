import { query } from '../../../lib/mysql';
import { StockMovementRepository, GetStockMovementsFilters } from '../../core/inventory/domain/IStockMovementRepository';
import { StockMovementEntity } from '../../core/inventory/domain/StockMovement';

export class MySqlStockMovementRepository implements StockMovementRepository {
  async findAll(filters: GetStockMovementsFilters): Promise<StockMovementEntity[]> {
    let sql = `
      SELECT 
        id, product_id as productId, product_name as productName, movement_type as movementType, 
        quantity_change as quantityChange, previous_stock as previousStock, new_stock as newStock, 
        reference_id as referenceId, reference_type as referenceType, notes, user_name as userName, 
        warehouse_id as warehouseId, created_at as createdAt, updated_at as updatedAt 
      FROM stock_movements 
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filters.productId) {
      sql += ' AND product_id = ?';
      params.push(filters.productId);
    }
    if (filters.warehouseId) {
      sql += ' AND warehouse_id = ?';
      params.push(filters.warehouseId);
    }
    if (filters.startDate) {
      sql += ' AND created_at >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ' AND created_at <= ?';
      params.push(filters.endDate);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
      if (filters.offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(filters.offset);
      }
    }

    const movements: any[] = await query(sql, params);
    return movements.map(m => ({
      ...m,
      quantityChange: parseFloat(m.quantityChange),
      previousStock: parseFloat(m.previousStock),
      newStock: parseFloat(m.newStock)
    }));
  }

  async countAll(filters: GetStockMovementsFilters): Promise<number> {
    let sql = 'SELECT COUNT(*) as total FROM stock_movements WHERE 1=1';
    const params: any[] = [];

    if (filters.productId) {
      sql += ' AND product_id = ?';
      params.push(filters.productId);
    }
    if (filters.warehouseId) {
      sql += ' AND warehouse_id = ?';
      params.push(filters.warehouseId);
    }
    if (filters.startDate) {
      sql += ' AND created_at >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ' AND created_at <= ?';
      params.push(filters.endDate);
    }

    const result = await query(sql, params);
    return result[0]?.total || 0;
  }

  async create(movement: Partial<StockMovementEntity>): Promise<string> {
    const sql = `
      INSERT INTO stock_movements (
        id, product_id, product_name, movement_type, quantity_change, previous_stock, new_stock,
        reference_id, reference_type, notes, user_name, warehouse_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const id = movement.id || `mov_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    await query(sql, [
      id, movement.productId, movement.productName, movement.movementType, 
      movement.quantityChange, movement.previousStock, movement.newStock, 
      movement.referenceId || null, movement.referenceType || null, 
      movement.notes || null, movement.userName || null, movement.warehouseId || null
    ]);

    return id;
  }
}
