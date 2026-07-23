import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '@/lib/mysql';
import { addFamilyStock, deductFamilyStock, findUltimateRoot } from '@/lib/family-sync';
import { isService } from '@/lib/product-type';

// GET endpoint to fetch stock adjustments
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const productId = searchParams.get('productId');

    let sql = `
      SELECT
        sa.id,
        sa.product_id AS productId,
        p.name AS productName,
        sa.quantity,
        sa.reason,
        sa.new_stock AS newStock,
        sa.created_at AS createdAt,
        sa.updated_at AS updatedAt
      FROM stock_adjustments sa
      LEFT JOIN products p ON sa.product_id = p.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (productId) {
      sql += ' AND sa.product_id = ?';
      params.push(productId);
    }

    sql += ' ORDER BY sa.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const adjustments = await query(sql, params);

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM stock_adjustments WHERE 1=1';
    const countParams: any[] = [];

    if (productId) {
      countSql += ' AND product_id = ?';
      countParams.push(productId);
    }

    const countResult = await query(countSql, countParams);
    const total = countResult[0]?.total || 0;

    return NextResponse.json({
      success: true,
      data: adjustments,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching stock adjustments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stock adjustments' },
      { status: 500 }
    );
  }
}

// POST endpoint to create a new stock adjustment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productId, quantity, reason } = body;

    if (!productId || quantity === undefined || !reason) {
      return NextResponse.json(
        { success: false, error: 'Product ID, quantity, and reason are required' },
        { status: 400 }
      );
    }

    return await withTransaction(async (connection) => {
      // Get current product stock
      const [productResult]: any = await connection.query('SELECT id, name, stock, type FROM products WHERE id = ?', [productId]);
      if (!productResult || productResult.length === 0) {
        throw new Error('Product not found');
      }

      const product = productResult[0];
      if (isService(product)) {
        throw new Error('Services do not carry stock and cannot be adjusted');
      }
      const currentStock = Number(product.stock || 0);
      const newStock = currentStock + quantity;

      // --- Family Stock Sync ---
      const { rootId, factorToRoot } = await findUltimateRoot(productId, connection as any);
      const rootQuantity = Math.abs(quantity) / factorToRoot;

      const adjustmentId = uuidv4();

      if (quantity < 0) {
        await deductFamilyStock(rootId, rootQuantity, adjustmentId, 'adjustment', reason, connection as any);
      } else if (quantity > 0) {
        await addFamilyStock(rootId, rootQuantity, adjustmentId, 'adjustment', reason, connection as any);
      } else {
        // If qty is 0, still update the product to refresh its timestamp
        await connection.query('UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [productId]);
      }

      // Record the adjustment
      const adjustmentSql = `
        INSERT INTO stock_adjustments (id, product_id, quantity, reason, new_stock)
        VALUES (?, ?, ?, ?, ?)
      `;
      // Fetch new stock after sync to be accurate
      const [newProductResult]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [productId]);
      const actualNewStock = newProductResult[0]?.stock || newStock;

      await connection.query(adjustmentSql, [adjustmentId, productId, quantity, reason, actualNewStock]);

      return NextResponse.json({
        success: true,
        message: 'Stock adjustment created successfully',
        data: {
          id: adjustmentId,
          productId,
          productName: product.name,
          quantity,
          previousStock: currentStock,
          newStock: actualNewStock,
          reason
        },
        timestamp: new Date().toISOString()
      });
    });
  } catch (error: any) {
    console.error('Error creating stock adjustment:', error);
    if (error?.message === 'Services do not carry stock and cannot be adjusted') {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to create stock adjustment' },
      { status: 500 }
    );
  }
}
