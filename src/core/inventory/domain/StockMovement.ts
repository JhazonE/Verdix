export interface StockMovementEntity {
  id: string;
  productId: string;
  productName: string;
  movementType: 'in' | 'out' | 'adjustment' | 'transfer' | 'sale' | 'purchase' | 'return' | 'void';
  quantityChange: number;
  previousStock: number;
  newStock: number;
  referenceId?: string;
  referenceType?: string;
  notes?: string;
  /**
   * Always undefined from MySQL: `stock_movements` has no user column and the
   * canonical writer does not record one. See MySqlStockMovementRepository.
   */
  userName?: string;
  warehouseId?: string;
  createdAt?: string;
  updatedAt?: string;
}
