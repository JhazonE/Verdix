import { NextRequest, NextResponse } from 'next/server';
import { MySqlProductRepository } from '../../../src/infrastructure/repositories/MySqlProductRepository';
import { GetProductsUseCase } from '../../../src/core/products/application/GetProductsUseCase';
import { CreateProductUseCase } from '../../../src/core/products/application/CreateProductUseCase';

// Initialize dependencies
const productRepository = new MySqlProductRepository();
const getProductsUseCase = new GetProductsUseCase(productRepository);
const createProductUseCase = new CreateProductUseCase(productRepository);

// GET endpoint to fetch products
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const offset = parseInt(searchParams.get('offset') || '0');
    const countOnly = searchParams.get('countOnly') === 'true';

    const filters = {
      category: searchParams.get('category'),
      search: searchParams.get('search'),
      warehouseId: searchParams.get('warehouseId'),
      availability: searchParams.get('availability'),
      supplierId: searchParams.get('supplierId'),
      shelfLocationId: searchParams.get('shelfLocationId'),
      // Optional: restrict to stock > 0, applied in SQL before the LIMIT.
      // No caller currently sets it — the transfer/shelf boards deliberately
      // do not, because on this catalogue only 4 of 15,633 rows have stock > 0
      // and the filter emptied them. Each board applies its own display gate.
      inStock: searchParams.get('inStock') === 'true',
    };

    if (countOnly) {
      const total = await productRepository.countAll(filters);
      return NextResponse.json({
        success: true,
        total,
        timestamp: new Date().toISOString()
      });
    }

    const { products, total } = await getProductsUseCase.execute({
      limit,
      offset,
      filters
    });

    return NextResponse.json({
      success: true,
      data: products,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}

// POST endpoint to create a new product
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const productId = await createProductUseCase.execute(body);

    return NextResponse.json({
      success: true,
      message: 'Product created successfully',
      data: { id: productId, ...body },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error creating product:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create product' },
      { status: error.message === 'Name and price are required' ? 400 : 500 }
    );
  }
}
