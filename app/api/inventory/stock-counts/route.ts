import { NextRequest, NextResponse } from 'next/server';
import { MySqlStockCountRepository } from '../../../../src/infrastructure/repositories/MySqlStockCountRepository';
import { query } from '@/lib/mysql';

// Initialize dependencies
const stockCountRepository = new MySqlStockCountRepository();

export async function GET() {
  try {
    const counts = await stockCountRepository.findAll();
    return NextResponse.json({
      success: true,
      data: counts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching stock counts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stock counts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, warehouseId, shelfLocationId, shelfLocationIds, notes, createdBy } = body;
    const effectiveShelfIds = shelfLocationIds || (shelfLocationId ? [shelfLocationId] : []);
    
    // 1. Fetch products to include in the snapshot based on filters
    // Services are excluded: they have no stock, so a physical count of them
    // is meaningless.
    let productsSql = `SELECT id, name, stock, sku, barcode FROM products WHERE availability = 'available' AND type = 'standard'`;
    const params: any[] = [];
    
    if (warehouseId) {
      productsSql += ' AND warehouse_id = ?';
      params.push(warehouseId);
    }
    
    if (effectiveShelfIds && effectiveShelfIds.length > 0) {
      const placeholders = effectiveShelfIds.map(() => '?').join(',');
      productsSql += ` AND shelf_location_id IN (${placeholders})`;
      params.push(...effectiveShelfIds);
    }
    
    const products: any[] = await query(productsSql, params);
    
    // 2. Map products to stock count items
    const stockCountId = `sc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const items = products.map((p: any) => ({
      id: `sci_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      stockCountId: stockCountId,
      productId: p.id,
      productName: p.name,
      snapshotQuantity: parseFloat(p.stock || 0)
    }));
    
    // 3. Create the stock count with items
    await stockCountRepository.create({
      id: stockCountId,
      name,
      warehouseId,
      shelfLocationId: effectiveShelfIds.length > 0 ? effectiveShelfIds[0] : undefined,
      notes,
      createdBy: createdBy || 'Admin',
      status: 'in_progress',
      items
    });

    return NextResponse.json({
      success: true,
      message: 'Stock count created successfully with ' + items.length + ' items',
      data: { id: stockCountId },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error creating stock count:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create stock count' },
      { status: 500 }
    );
  }
}
