import { ProductRepository } from '../domain/IProductRepository';
import { ProductEntity } from '../domain/Product';

export interface CreateProductRequest {
  name: string;
  description: string;
  category: string;
  brand: string;
  stock?: number;
  price: number;
  cost?: number;
  sku?: string;
  barcode?: string;
  priceLevels?: { levelId: string; price: number; minQuantity: number }[];
}

export class CreateProductUseCase {
  constructor(private productRepository: ProductRepository) {}

  async execute(request: CreateProductRequest): Promise<string> {
    if (!request.name || !request.price) {
      throw new Error('Name and price are required');
    }
    if (!request.sku && !request.barcode) {
      throw new Error('Either sku or barcode is required');
    }

    const productId = await this.productRepository.create(request);
    return productId;
  }
}
