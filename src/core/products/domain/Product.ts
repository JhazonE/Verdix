export interface ProductEntity {
  id: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  department?: string;
  stock: number;
  price: number;
  cost?: number;
  sku: string;
  barcode?: string;
  vatStatus?: string;
  availability?: string;
  unitOfMeasure: string;
  reorderPoint: number;
  avgDailySales: number;
  expirationDate?: string;
  warehouseId?: string;
  shelfLocationId?: string | null; // @deprecated: Use shelfLocationIds
  shelfLocationIds?: string[];
  shelfQuantities?: Record<string, number>;
  createdAt?: string;
  updatedAt?: string;
  priceLevels?: ProductPriceLevel[];
  sellingUnits?: {
    id?: string;
    name: string;
    factor: number;
    barcode?: string;
    cost?: number;
    price: number;
    isBase?: boolean;
    priceLevels?: { levelId: string; price: number }[];
  }[];
}

export interface ProductPriceLevel {
  levelId: string;
  price: number;
}
