import { ProductEntity } from './Product';

export interface GetProductsFilters {
  category?: string | null;
  department?: string | null;
  search?: string | null;
  warehouseId?: string | null;
  availability?: string | null;
  supplierId?: string | null;
  shelfLocationId?: string | null; // @deprecated: Use shelfId
  shelfId?: string | null;
  /**
   * Return only products with stock > 0. Applied in SQL before the LIMIT, so
   * callers that can only act on stock they have (the transfer and shelf
   * boards) don't spend their row budget on out-of-stock products.
   */
  inStock?: boolean | null;
}

export interface ProductRepository {
  findAll(limit: number, offset: number, filters: GetProductsFilters): Promise<ProductEntity[]>;
  countAll(filters: GetProductsFilters): Promise<number>;
  findById(id: string): Promise<ProductEntity | null>;
  create(product: Partial<ProductEntity>): Promise<string>;
  update(id: string, product: Partial<ProductEntity>): Promise<void>;
  delete(id: string): Promise<void>;
}
