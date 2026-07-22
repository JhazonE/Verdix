import { query, withTransaction } from './mysql';
import { StockMovement } from './types';
import { v4 as uuidv4 } from 'uuid';
import mysql from 'mysql2/promise';
import { generateBatchId } from './batch-utils';
import { deductFromBatches } from './batch-deduction';
import { normalizeExpirationDate, refreshProductExpirationCache } from './expiration';

/**
 * Records a stock movement in the database
 * @param movement The stock movement data to record
 * @param connection Optional connection for transaction support
 * @returns The recorded movement with generated ID and timestamps
 */
export async function recordStockMovement(
  movement: Omit<StockMovement, 'id' | 'createdAt' | 'updatedAt'>,
  connection?: mysql.PoolConnection | mysql.Pool
): Promise<StockMovement> {
  const id = uuidv4();

  const sql = `
    INSERT INTO stock_movements (
      id, product_id, product_name, movement_type, quantity_change,
      previous_stock, new_stock, reference_id, reference_type, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    id,
    movement.productId,
    movement.productName,
    movement.movementType,
    movement.quantityChange,
    movement.previousStock,
    movement.newStock,
    movement.referenceId || null,
    movement.referenceType || null,
    movement.notes || null,
  ];

  if (connection) {
    await connection.query(sql, params);
  } else {
    await query(sql, params);
  }

  return {
    ...movement,
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Records stock movements for a sale transaction
 * @param saleId The sale ID
 * @param items Array of sale items with product info
 * @returns Array of recorded stock movements
 */
export async function recordSaleMovements(saleId: string, items: Array<{ product: { id: string; name: string; stock: number }; quantity: number }>): Promise<StockMovement[]> {
  const movements: StockMovement[] = [];

  for (const item of items) {
    const previousStock = item.product.stock;
    const quantityChange = -item.quantity; // Sales decrease stock
    const newStock = previousStock + quantityChange;

    const movement = await recordStockMovement({
      productId: item.product.id,
      productName: item.product.name,
      movementType: 'sale',
      quantityChange,
      previousStock,
      newStock,
      referenceId: saleId,
      referenceType: 'sale',
      notes: `Sale transaction`,
    });

    movements.push(movement);
  }

  return movements;
}

/**
 * Records stock movements for a purchase transaction
 * @param purchaseId The purchase ID
 * @param items Array of purchase items with product info
 * @returns Array of recorded stock movements
 */
export async function recordPurchaseMovements(purchaseId: string, items: Array<{ productId: string; productName: string; quantity: number }>): Promise<StockMovement[]> {
  const movements: StockMovement[] = [];

  for (const item of items) {
    // Get current stock for the product
    const currentStockResult = await query('SELECT stock FROM products WHERE id = ?', [item.productId]);
    const currentStock = currentStockResult[0]?.stock || 0;

    const previousStock = currentStock;
    const quantityChange = item.quantity; // Purchases increase stock
    const newStock = previousStock + quantityChange;

    const movement = await recordStockMovement({
      productId: item.productId,
      productName: item.productName,
      movementType: 'purchase',
      quantityChange,
      previousStock,
      newStock,
      referenceId: purchaseId,
      referenceType: 'purchase',
      notes: `Purchase transaction`,
    });

    movements.push(movement);
  }

  return movements;
}

/**
 * Records a stock adjustment movement
 * @param adjustmentId The adjustment ID
 * @param productId The product ID
 * @param productName The product name
 * @param quantityChange The quantity change
 * @param reason The adjustment reason
 * @returns The recorded stock movement
 */
export async function recordAdjustmentMovement(
  adjustmentId: string,
  productId: string,
  productName: string,
  quantityChange: number,
  reason: string,
  expirationDate?: string | null,
  connection?: mysql.PoolConnection | mysql.Pool
): Promise<StockMovement> {
  // Get current stock for the product
  const currentStockResult = await query('SELECT stock FROM products WHERE id = ?', [productId]);
  const currentStock = currentStockResult[0]?.stock || 0;

  const previousStock = currentStock - quantityChange; // Reverse to get previous stock
  const newStock = currentStock;

  const movement = await recordStockMovement({
    productId,
    productName,
    movementType: 'adjustment',
    quantityChange,
    previousStock,
    newStock,
    referenceId: adjustmentId,
    referenceType: 'adjustment',
    notes: reason,
  });

  // --- SHELF SYNC: Auto-allocate stock to shelves to prevent "Unassigned" status ---
  try {
    if (quantityChange > 0) {
      // Find the first assigned shelf for this product
      const shelfSql = 'SELECT shelf_id FROM product_shelves WHERE product_id = ? LIMIT 1';
      const shelfResult = await query(shelfSql, [productId]);
      const shelfId = shelfResult?.[0]?.shelf_id;
      
      if (shelfId) {
        await query('UPDATE product_shelves SET quantity = quantity + ? WHERE product_id = ? AND shelf_id = ?', [quantityChange, productId, shelfId]);
      }
    } else if (quantityChange < 0) {
      // Deduct from shelves
      let remainingToDeduct = Math.abs(quantityChange);
      const shelfSql = 'SELECT shelf_id, quantity FROM product_shelves WHERE product_id = ? AND quantity > 0 ORDER BY quantity DESC';
      const shelfRows = await query(shelfSql, [productId]);
      
      for (const shelf of (shelfRows || [])) {
        if (remainingToDeduct <= 0) break;
        const take = Math.min(shelf.quantity, remainingToDeduct);
        if (take > 0) {
          await query('UPDATE product_shelves SET quantity = quantity - ? WHERE product_id = ? AND shelf_id = ?', [take, productId, shelf.shelf_id]);
          remainingToDeduct -= take;
        }
      }
    }
  } catch (shelfErr) {
    console.warn('[ShelfSync] Failed to sync shelf quantities in adjustment:', shelfErr);
  }

  // --- BATCH COSTING: Sync Batch quantities with adjustments ---
  try {
    if (quantityChange > 0) {
      // INCREASE: Create a new batch
      const batchId = generateBatchId();
      const costInfo = await query('SELECT cost, price FROM products WHERE id = ?', [productId]);
      const unitCost = costInfo?.[0]?.cost ? parseFloat(costInfo[0].cost) : 0;
      const sellingPrice = costInfo?.[0]?.price ? parseFloat(costInfo[0].price) : 0;

      const normalizedExpiry = normalizeExpirationDate(expirationDate);

      const batchSql = `
        INSERT INTO inventory_batches
          (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes, expiration_date)
        VALUES (?, ?, CURDATE(), ?, ?, ?, ?, 'adjustment', ?, ?)
      `;
      const batchParams = [
        batchId, productId, quantityChange, quantityChange, unitCost, sellingPrice, `Auto-generated from adjustment: ${reason}`, normalizedExpiry
      ];

      if (connection) {
        await connection.query(batchSql, batchParams);
      } else {
        await query(batchSql, batchParams);
      }

      if (normalizedExpiry) {
        await refreshProductExpirationCache(productId, connection);
      }
    } else if (quantityChange < 0) {
      // DECREASE: Deduct from existing batches using FIFO
      // This is critical for Physical Counts that reduce stock to prevent "exhausted" batch errors
      const qtyToDeduct = Math.abs(quantityChange);
      await withTransaction(async (conn) => {
          await deductFromBatches(productId, qtyToDeduct, false, conn as any);
      });
    }
  } catch (batchErr) {
    console.warn('[BatchCosting] Could not sync batches for adjustment:', batchErr);
  }

  return movement;
}

/**
 * Gets stock movements for a specific product
 * @param productId The product ID
 * @param limit Optional limit for number of results
 * @returns Array of stock movements
 */
export async function getStockMovementsByProduct(productId: string, limit?: number): Promise<StockMovement[]> {
  let sql = `
    SELECT
      id, product_id as productId, product_name as productName,
      movement_type as movementType, quantity_change as quantityChange,
      previous_stock as previousStock, new_stock as newStock,
      reference_id as referenceId, reference_type as referenceType,
      notes, created_at as createdAt, updated_at as updatedAt
    FROM stock_movements
    WHERE product_id = ?
    ORDER BY created_at DESC
  `;

  const params: any[] = [productId];

  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  const results = await query(sql, params);
  return results as StockMovement[];
}

/**
 * Gets all stock movements with optional filters
 * @param filters Optional filters for movement type, date range, etc.
 * @returns Array of stock movements
 */
export async function getStockMovements(filters?: {
  movementType?: string;
  productId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<StockMovement[]> {
  let sql = `
    SELECT
      id, product_id as productId, product_name as productName,
      movement_type as movementType, quantity_change as quantityChange,
      previous_stock as previousStock, new_stock as newStock,
      reference_id as referenceId, reference_type as referenceType,
      notes, created_at as createdAt, updated_at as updatedAt
    FROM stock_movements
    WHERE 1=1
  `;

  const params: any[] = [];

  if (filters?.movementType) {
    sql += ' AND movement_type = ?';
    params.push(filters.movementType);
  }

  if (filters?.productId) {
    sql += ' AND product_id = ?';
    params.push(filters.productId);
  }

  if (filters?.dateFrom) {
    sql += ' AND created_at >= ?';
    params.push(filters.dateFrom);
  }

  if (filters?.dateTo) {
    sql += ' AND created_at <= ?';
    params.push(filters.dateTo);
  }

  sql += ' ORDER BY created_at DESC';

  if (filters?.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }

  const results = await query(sql, params);
  return results as StockMovement[];
}

/**
 * Updates product stock and records the movement
 * @param productId The product ID
 * @param quantityChange The quantity change (positive for increase, negative for decrease)
 * @param movementType The type of movement
 * @param referenceId Optional reference ID
 * @param referenceType Optional reference type
 * @param notes Optional notes
 * @returns The recorded stock movement
 */
export async function updateStockAndRecordMovement(
  productId: string,
  quantityChange: number,
  movementType: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  referenceId?: string,
  referenceType?: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  notes?: string,
  connection?: mysql.PoolConnection | mysql.Pool,
  expirationDate?: string | null
): Promise<StockMovement> {
  // Get current product info
  const productSql = 'SELECT name, stock FROM products WHERE id = ?';
  const productResult = connection 
    ? (await connection.query(productSql, [productId]))[0] as any[]
    : await query(productSql, [productId]);
    
  if (!productResult || productResult.length === 0) {
    throw new Error(`Product with ID ${productId} not found`);
  }

  const product = productResult[0];
  const previousStock = Number(product.stock || 0);
  const numericChange = Number(quantityChange || 0);
  const newStock = previousStock + numericChange;

  console.log(`[StockMove] Updating Product: ${productId} (${product.name})`);
  console.log(`           Change: ${numericChange}, Prev: ${previousStock}, New: ${newStock}`);

  // Update product stock
  const updateSql = 'UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  if (connection) {
    await (connection as mysql.PoolConnection).query(updateSql, [newStock, productId]);
  } else {
    await query(updateSql, [newStock, productId]);
  }

  // Record the movement
  const movement = await recordStockMovement({
    productId,
    productName: product.name,
    movementType,
    quantityChange: numericChange,
    previousStock,
    newStock,
    referenceId,
    referenceType,
    notes,
  }, connection);

  // --- SHELF SYNC: Auto-allocate stock to shelves to prevent "Unassigned" status ---
  try {
    if (numericChange > 0) {
      // Find the first assigned shelf for this product
      const shelfSql = 'SELECT shelf_id FROM product_shelves WHERE product_id = ? LIMIT 1';
      const shelfResult = connection 
        ? (await (connection as mysql.PoolConnection).query(shelfSql, [productId]))[0] as any[]
        : await query(shelfSql, [productId]);
      
      const shelfId = shelfResult?.[0]?.shelf_id;
      
      if (shelfId) {
        const updateShelfSql = 'UPDATE product_shelves SET quantity = quantity + ? WHERE product_id = ? AND shelf_id = ?';
        if (connection) {
          await (connection as mysql.PoolConnection).query(updateShelfSql, [numericChange, productId, shelfId]);
        } else {
          await query(updateShelfSql, [numericChange, productId, shelfId]);
        }
      }
    } else if (numericChange < 0) {
      // Deduct from shelves (FIFO-ish: take from the shelf with the most stock first)
      let remainingToDeduct = Math.abs(numericChange);
      const shelfSql = 'SELECT shelf_id, quantity FROM product_shelves WHERE product_id = ? AND quantity > 0 ORDER BY quantity DESC';
      const shelfRows = connection 
        ? (await (connection as mysql.PoolConnection).query(shelfSql, [productId]))[0] as any[]
        : await query(shelfSql, [productId]);
      
      for (const shelf of (shelfRows || [])) {
        if (remainingToDeduct <= 0) break;
        const take = Math.min(shelf.quantity, remainingToDeduct);
        if (take > 0) {
          const updateShelfSql = 'UPDATE product_shelves SET quantity = quantity - ? WHERE product_id = ? AND shelf_id = ?';
          if (connection) {
            await (connection as mysql.PoolConnection).query(updateShelfSql, [take, productId, shelf.shelf_id]);
          } else {
            await query(updateShelfSql, [take, productId, shelf.shelf_id]);
          }
          remainingToDeduct -= take;
        }
      }
    }
  } catch (shelfErr) {
    console.warn('[ShelfSync] Failed to sync shelf quantities:', shelfErr);
  }

  // --- BATCH COSTING: Sync Batch quantities with stock movements ---
  if (['adjustment', 'transfer', 'return'].includes(movementType)) {
    try {
      if (numericChange > 0) {
        // INCREASE: Create a new batch
        const batchId = generateBatchId();
        
        const costInfo = connection 
          ? (await connection.query('SELECT cost, price FROM products WHERE id = ?', [productId]))[0] as any[]
          : await query('SELECT cost, price FROM products WHERE id = ?', [productId]);
          
        const unitCost = costInfo?.[0]?.cost ? parseFloat(costInfo[0].cost) : 0;
        const sellingPrice = costInfo?.[0]?.price ? parseFloat(costInfo[0].price) : 0;

        const normalizedExpiry = normalizeExpirationDate(expirationDate);

        const batchSql = `
          INSERT INTO inventory_batches
            (id, product_id, received_date, quantity_in, quantity_remaining, unit_cost, selling_price, source_type, notes, expiration_date)
          VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)
        `;
        const batchParams = [
          batchId,
          productId,
          numericChange,
          numericChange,
          unitCost,
          sellingPrice,
          movementType,
          notes ? `Auto-batch for ${movementType}: ${notes}` : `Auto-batch for ${movementType}`,
          normalizedExpiry
        ];

        if (connection) {
          await connection.query(batchSql, batchParams);
        } else {
          await query(batchSql, batchParams);
        }

        if (normalizedExpiry) {
          await refreshProductExpirationCache(productId, connection);
        }
      } else if (numericChange < 0) {
        // DECREASE: Deduct from batches (FIFO)
        // This is critical for Physical Counts that reduce stock to prevent "exhausted" batch errors
        const qtyToDeduct = Math.abs(numericChange);
        
        if (connection) {
          // Use our FIFO deduction utility
          // oversellBlock = false because we are just syncing reality, not blocking a sale
          await deductFromBatches(productId, qtyToDeduct, false, connection as any);
        } else {
          // If no connection, we need one to ensure atomicity
          await withTransaction(async (conn) => {
            await deductFromBatches(productId, qtyToDeduct, false, conn as any);
          });
        }
      }
    } catch (batchErr) {
      console.warn('[BatchCosting] Could not sync batches for movement:', batchErr);
    }
  }

  return movement;
}

/**
 * Records stock movements for a transfer between warehouses
 * @param transferId The transfer ID (reference)
 * @param sourceProductId The source product ID
 * @param targetProductId The target product ID
 * @param quantity The quantity transferred (positive)
 * @param notes Optional notes
 * @param connection Optional connection for transaction support
 */
export async function recordTransferMovements(
  transferId: string,
  sourceProductId: string,
  targetProductId: string,
  quantity: number,
  notes?: string,
  connection?: mysql.PoolConnection | mysql.Pool
): Promise<{ sourceMovement: StockMovement; targetMovement: StockMovement }> {
  // 1. Record OUT movement from source
  const sourceMovement = await updateStockAndRecordMovement(
    sourceProductId,
    -quantity,
    'transfer',
    transferId,
    'transfer',
    `Transfer to product ${targetProductId}${notes ? ': ' + notes : ''}`,
    connection
  );

  // 2. Record IN movement to target
  const targetMovement = await updateStockAndRecordMovement(
    targetProductId,
    quantity,
    'transfer',
    transferId,
    'transfer',
    `Transfer from product ${sourceProductId}${notes ? ': ' + notes : ''}`,
    connection
  );

  return { sourceMovement, targetMovement };
}
