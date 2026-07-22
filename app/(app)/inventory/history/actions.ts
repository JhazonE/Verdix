'use server';

import { query } from '@/lib/mysql';
import { recordAdjustmentMovement } from '@/lib/stock-movements';
import type { StockAdjustment } from '@/lib/types';

export async function getStockAdjustments(limit?: number, offset?: number) {
  try {
    // 1. Fetch completed adjustments
    let adjSql = `
      SELECT
        sa.*,
        'Completed' as status,
        p.name as product_name,
        p.sku as product_sku,
        p.category,
        p.brand
      FROM stock_adjustments sa
      LEFT JOIN products p ON sa.product_id = p.id
    `;
    const params: any[] = [];
    const completedAdjustments = await query(adjSql);

    // 2. Fetch pending adjustments from approval queue
    let queueSql = `
      SELECT 
        aq.*,
        p.name as product_name,
        p.sku as product_sku,
        p.category,
        p.brand
      FROM approval_queue aq
      LEFT JOIN products p ON JSON_UNQUOTE(JSON_EXTRACT(aq.transaction_data, '$.productId')) = p.id
      WHERE aq.transaction_type = 'STOCK_ADJUSTMENT' AND aq.status = 'Pending'
    `;
    const pendingQueue = await query(queueSql);

    // 3. Combine and sort
    const mappedCompleted = (completedAdjustments || []).map((adj: any) => ({
      id: adj.id,
      productId: adj.product_id,
      productName: adj.product_name,
      quantity: parseInt(adj.quantity),
      reason: adj.reason,
      date: adj.created_at,
      newStock: parseInt(adj.new_stock),
      status: 'Completed',
      product: adj.product_name ? {
        id: adj.product_id,
        name: adj.product_name,
        sku: adj.product_sku,
        category: adj.category,
        brand: adj.brand
      } : undefined
    }));

    const mappedPending = (pendingQueue || []).map((item: any) => {
      const txData = typeof item.transaction_data === 'string' ? JSON.parse(item.transaction_data) : item.transaction_data;
      return {
        id: item.id,
        productId: txData.productId,
        productName: item.product_name || 'Unknown Product',
        quantity: parseInt(txData.quantity),
        reason: txData.reason,
        date: item.created_at,
        newStock: 0, // Not finalized yet
        status: 'Pending',
        product: item.product_name ? {
            id: txData.productId,
            name: item.product_name,
            sku: item.product_sku,
            category: item.category,
            brand: item.brand
        } : undefined
      };
    });

    const allAdjustments = [...mappedPending, ...mappedCompleted].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    if (limit !== undefined && offset !== undefined) {
      return allAdjustments.slice(offset, offset + limit) as StockAdjustment[];
    }

    return allAdjustments as StockAdjustment[];
  } catch (error) {
    console.error('Error fetching stock adjustments:', error);
    return [];
  }
}

export async function getStockAdjustmentsCount() {
  try {
    const sql = `SELECT COUNT(*) as count FROM stock_adjustments`;
    const result = await query(sql);
    return result[0].count;
  } catch (error) {
    console.error('Error fetching stock adjustments count:', error);
    return 0;
  }
}

export async function createStockAdjustment(productId: string, quantity: number, reason: string, newStock: number) {
  try {
    const adjustmentId = `adj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const sql = `
      INSERT INTO stock_adjustments (id, product_id, quantity, reason, new_stock)
      VALUES (?, ?, ?, ?, ?)
    `;

    await query(sql, [adjustmentId, productId, quantity, reason, newStock]);

    // Get product name for recording movement
    const getProductSql = `SELECT name FROM products WHERE id = ?`;
    const productResult = await query(getProductSql, [productId]);
    const productName = productResult[0]?.name || 'Unknown Product';

    // Record the adjustment in stock movements
    await recordAdjustmentMovement(adjustmentId, productId, productName, quantity, reason);

    return { success: true, adjustmentId };
  } catch (error) {
    console.error('Error creating stock adjustment:', error);
    return { success: false, error: 'Failed to create stock adjustment' };
  }
}

export async function getStockAdjustmentsByProduct(productId: string, limit?: number) {
  try {
    let sql = `
      SELECT
        sa.*,
        p.name as product_name,
        p.sku as product_sku
      FROM stock_adjustments sa
      LEFT JOIN products p ON sa.product_id = p.id
      WHERE sa.product_id = ?
      ORDER BY sa.created_at DESC
    `;

    const params: any[] = [productId];

    if (limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    const adjustments = await query(sql, params);

    return adjustments.map((adj: any) => ({
      id: adj.id,
      productId: adj.product_id,
      productName: adj.product_name,
      quantity: parseInt(adj.quantity),
      reason: adj.reason,
      date: adj.created_at,
      newStock: parseInt(adj.new_stock),
      product: adj.product_name ? {
        id: adj.product_id,
        name: adj.product_name,
        sku: adj.product_sku
      } : undefined
    })) as StockAdjustment[];
  } catch (error) {
    console.error('Error fetching stock adjustments by product:', error);
    return [];
  }
}

export async function migrateAdjustmentsToMovements() {
  try {
    // Get all stock adjustments that don't have corresponding movements
    const sql = `
      SELECT sa.*, p.name as product_name
      FROM stock_adjustments sa
      LEFT JOIN products p ON sa.product_id = p.id
      LEFT JOIN stock_movements sm ON sa.id = sm.reference_id AND sm.reference_type = 'adjustment'
      WHERE sm.id IS NULL
    `;

    const adjustments = await query(sql);

    let migratedCount = 0;

    for (const adj of adjustments) {
      try {
        // Calculate previous stock: new_stock - quantity
        const previousStock = adj.new_stock - adj.quantity;

        await recordAdjustmentMovement(
          adj.id,
          adj.product_id,
          adj.product_name || 'Unknown Product',
          adj.quantity,
          adj.reason
        );

        migratedCount++;
      } catch (error) {
        console.error(`Failed to migrate adjustment ${adj.id}:`, error);
      }
    }

    return { success: true, migratedCount };
  } catch (error) {
    console.error('Error migrating adjustments to movements:', error);
    return { success: false, error: 'Failed to migrate adjustments' };
  }
}

import { checkApprovalRequired, submitToApprovalQueue } from '@/lib/approvals';
import { withTransaction } from '@/lib/mysql';
import { deductFamilyStock, addFamilyStock, findUltimateRoot } from '@/lib/family-sync';

export async function adjustStock(productId: string, quantity: number, reason: string, userId: string = 'system', isInternalFinalization: boolean = false, expirationDate?: string | null) {
  try {
    // 1. Check if multi-level approval is required
    const isApprovalRequired = !isInternalFinalization && await checkApprovalRequired('STOCK_ADJUSTMENT');
    
    if (isApprovalRequired) {
      // Get product info for enrichment
      const productInfoRes: any = await query(`
        SELECT p.name, p.stock, p.sku, p.barcode, w.name as warehouse_name, s.name as shelf_name
        FROM products p
        LEFT JOIN warehouses w ON p.warehouse_id = w.id
        LEFT JOIN shelf_locations s ON p.shelf_location_id = s.id
        WHERE p.id = ?
      `, [productId]);
      const productInfo = productInfoRes[0] || { name: 'Unknown', stock: 0, sku: '', barcode: '', warehouse_name: null, shelf_name: null };

      // Submit to approval queue instead of executing
      console.log('Stock adjustment submitted for approval:', { productId, quantity, reason });
      const { queueId, pendingApproval } = await submitToApprovalQueue('STOCK_ADJUSTMENT', {
        productId,
        quantity,
        reason,
        productName: productInfo.name,
        productSku: productInfo.sku,
        productBarcode: productInfo.barcode,
        warehouseName: productInfo.warehouse_name,
        shelfName: productInfo.shelf_name,
        currentStock: parseInt(productInfo.stock || 0),
        expirationDate: expirationDate || null
      }, userId);
      
      if (pendingApproval) {
        return { success: true, pendingApproval: true, queueId };
      }
      // If not pending (all steps auto-skipped), fall through to immediate execution
    }

    // Get current stock and product info
    const productResult = await query('SELECT stock, name, parent_id FROM products WHERE id = ?', [productId]);

    if (productResult.length === 0) {
      return { success: false, error: 'Product not found' };
    }

    const currentStock = parseInt(productResult[0].stock);
    const productName = productResult[0].name;
    const parentId = productResult[0].parent_id;
    const newStock = currentStock + quantity;

    // Validate new stock is not negative
    if (newStock < 0) {
      return { success: false, error: 'Stock cannot go below zero' };
    }

    // Create stock adjustment record ID (used as the reference for movements)
    const adjustmentId = `adj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create stock adjustment record for the main product (before we update stock)
    const createAdjustmentSql = `
      INSERT INTO stock_adjustments (id, product_id, quantity, reason, new_stock)
      VALUES (?, ?, ?, ?, ?)
    `;
    await query(createAdjustmentSql, [adjustmentId, productId, quantity, reason, newStock]);

    // Use recursive family sync within a transaction so all levels update atomically
    const result = await withTransaction(async (connection) => {
      // Walk the FULL ancestor chain (handles grandchildren, any depth)
      const { rootId, factorToRoot } = await findUltimateRoot(productId, connection);

      if (factorToRoot > 1 || rootId !== productId) {
        // This product is NOT the root — convert to root units and sync from root
        const rootQty = Math.abs(quantity) / factorToRoot;
        if (quantity < 0) {
          await deductFamilyStock(rootId, rootQty, adjustmentId, 'adjustment', reason, connection);
        } else {
          await addFamilyStock(rootId, rootQty, adjustmentId, 'adjustment', reason, connection, 0, expirationDate);
        }
      } else {
        // This IS the root — propagate down through all descendants
        if (quantity < 0) {
          await deductFamilyStock(productId, Math.abs(quantity), adjustmentId, 'adjustment', reason, connection);
        } else {
          await addFamilyStock(productId, quantity, adjustmentId, 'adjustment', reason, connection, 0, expirationDate);
        }
      }
      return { success: true, adjustmentId, newStock };
    });

    return result;
  } catch (error) {
    console.error('Error adjusting stock:', error);
    return { success: false, error: 'Failed to adjust stock' };
  }
}

