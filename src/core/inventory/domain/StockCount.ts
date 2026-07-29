export interface StockCountEntity {
  id: string;
  name: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  notes?: string;
  warehouseId?: string;
  warehouseName?: string;
  shelfLocationId?: string;
  shelfName?: string;
  shelfNames?: string[];
  createdBy?: string;
  completedBy?: string;
  completedAt?: string;
  snapshotAt?: string;
  items: StockCountItemEntity[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StockCountItemEntity {
  id: string;
  stockCountId: string;
  productId: string;
  productName?: string;
  sku?: string;
  barcode?: string;
  snapshotQuantity: number;
  countedQuantity?: number;
  countedAt?: string;
  variance?: number;
  adjustmentReason?: string;
  createdAt?: string;
  updatedAt?: string;
}
