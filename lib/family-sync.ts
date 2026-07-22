import { PoolConnection } from 'mysql2/promise';
import { updateStockAndRecordMovement } from './stock-movements';

// ---------------------------------------------------------------------------
// Recursive helpers for multi-level parent → child → grandchild stock sync
// ---------------------------------------------------------------------------

/**
 * Recursively collects ALL descendants of a product, any depth.
 * Returns a flat array of { id, name, stock, unitOfMeasure, parentId }.
 */
async function getAllDescendants(
  productId: string,
  connection: PoolConnection
): Promise<Array<{ id: string; name: string; stock: number; unitOfMeasure: string; parentId: string }>> {
  const [directChildren]: any = await connection.query(
    'SELECT id, name, stock, unit_of_measure as unitOfMeasure, parent_id as parentId FROM products WHERE parent_id = ?',
    [productId]
  );

  let result: Array<{ id: string; name: string; stock: number; unitOfMeasure: string; parentId: string }> = [];
  for (const child of directChildren) {
    result.push(child);
    // Recurse into child's own children
    const grandchildren = await getAllDescendants(child.id, connection);
    result = result.concat(grandchildren);
  }
  return result;
}

/**
 * Walks from the sold/adjusted product ALL THE WAY UP the ancestor chain
 * to find the ultimate root product and the cumulative conversion factor.
 *
 * Example hierarchy — Sugar 25kg → Sugar 1kg → Sugar 500g:
 *   findUltimateRoot(Sugar500g)
 *     → rootId: Sugar25kg
 *     → factorToRoot: 50   (1 Sugar25kg = 25 Sugar1kg = 50 Sugar500g)
 *
 * Selling 10 Sugar500g → qty in root units = 10 / 50 = 0.2 Sugar25kg
 *
 * @param productId  The product that is being sold/adjusted
 * @param connection Active DB connection
 * @returns { rootId, factorToRoot }
 *            rootId       — ID of the ultimate ancestor with no parent
 *            factorToRoot — how many of `productId`'s unit = 1 root unit
 *                           (multiply sold qty by this to get root-equivalent qty,
 *                            or divide to convert sold qty to root qty)
 */
export async function findUltimateRoot(
  productId: string,
  connection: PoolConnection
): Promise<{ rootId: string; factorToRoot: number }> {
  let currentId = productId;
  let cumulativeFactor = 1;
  let guard = 0; // infinite-loop guard

  while (guard++ < 15) {
    const [rows]: any = await connection.query(
      'SELECT id, parent_id, unit_of_measure FROM products WHERE id = ?',
      [currentId]
    );
    const prod = rows?.[0];
    if (!prod || !prod.parent_id) {
      // currentId is the ultimate root
      return { rootId: currentId, factorToRoot: cumulativeFactor };
    }

    // Find the conversion factor stored on the PARENT that maps this unit
    const [cfRows]: any = await connection.query(
      'SELECT factor FROM conversion_factors WHERE product_id = ? AND unit = ?',
      [prod.parent_id, prod.unit_of_measure]
    );
    const factor = cfRows?.[0] ? parseFloat(cfRows[0].factor) : 1;
    cumulativeFactor *= factor;

    currentId = prod.parent_id; // Move one level up
  }

  // Fallback — treat the current product as its own root (should never hit this)
  return { rootId: currentId, factorToRoot: cumulativeFactor };
}


/**
 * Deducts stock for the sold/adjusted product AND every descendant in its tree.
 *
 * Algorithm (applied recursively at every level):
 *  - For the sold node, deduct `quantitySold` directly.
 *  - For each direct child of that node, look up the child's conversion factor
 *    stored on the PARENT's conversion_factors table and compute:
 *      childDeduction = quantitySold * factor
 *  - Recurse into those children the same way.
 *
 * This handles arbitrarily deep hierarchies:
 *   Sugar 25 kg  →  sold 1  →  deduct 1
 *     └─ Sugar 1 kg  (factor 25)  →  deduct 25
 *          └─ Sugar 500 g  (factor 2 per 1 kg)  →  deduct 50
 *
 * @param nodeId       ID of the product whose stock is being deducted
 * @param qty          Quantity to deduct FROM this node (already in this node's units)
 * @param refId        Sale / order / adjustment reference ID (for stock movement log)
 * @param refType      Reference type string
 * @param notes        Notes suffix for the movement record
 * @param connection   Active DB transaction connection
 * @param depth        Internal recursion guard (max 10 levels)
 */
export async function deductFamilyStock(
  nodeId: string,
  qty: number,
  refId: string,
  refType: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  notes: string,
  connection: PoolConnection,
  depth = 0
): Promise<void> {
  if (depth > 10 || qty <= 0) return;

  const numericQty = Number(qty || 0);

  // 1. Deduct this node's own stock
  await updateStockAndRecordMovement(
    nodeId,
    -numericQty,
    refType,
    refId,
    refType,
    `${notes}${depth > 0 ? ` (Depth ${depth} family sync)` : ''}`,
    connection
  );

  // 2. Fetch direct children together with their conversion factor in one query.
  //    Children whose unit has no factor defined are excluded (same as skipping).
  const [children]: any = await connection.query(
    `SELECT p.id, cf.factor
     FROM products p
     JOIN conversion_factors cf ON cf.product_id = ? AND cf.unit = p.unit_of_measure
     WHERE p.parent_id = ?`,
    [nodeId, nodeId]
  );
  if (!children || children.length === 0) return; // No children to sync

  // 3. For each child, calculate how much to deduct and recurse
  for (const child of children) {
    const factorNum = Number(child.factor || 0);
    const childDeduction = numericQty * factorNum;
    await deductFamilyStock(
      child.id,
      childDeduction,
      refId,
      refType,
      notes,
      connection,
      depth + 1
    );
  }
}

/**
 * Same as deductFamilyStock but for ADDING stock (e.g. returns, purchases).
 * Pass a positive `qty`; the function applies +qty to the node and propagates.
 */
export async function addFamilyStock(
  nodeId: string,
  qty: number,
  refId: string,
  refType: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer',
  notes: string,
  connection: PoolConnection,
  depth = 0,
  expirationDate?: string | null
): Promise<void> {
  if (depth > 10 || qty <= 0) return;

  const numericQty = Number(qty || 0);

  await updateStockAndRecordMovement(
    nodeId,
    numericQty,
    refType,
    refId,
    refType,
    `${notes}${depth > 0 ? ` (Depth ${depth} family sync)` : ''}`,
    connection,
    // Only the directly-adjusted product carries the expiry. Cascaded child
    // batches (a 1kg bag's 250g sachets) are left NULL rather than inheriting a
    // date nobody entered for them — see the follow-up note in the spec.
    depth === 0 ? expirationDate : null
  );

  const [children]: any = await connection.query(
    `SELECT p.id, cf.factor
     FROM products p
     JOIN conversion_factors cf ON cf.product_id = ? AND cf.unit = p.unit_of_measure
     WHERE p.parent_id = ?`,
    [nodeId, nodeId]
  );
  if (!children || children.length === 0) return;

  for (const child of children) {
    const factorNum = Number(child.factor || 0);
    const childAddition = numericQty * factorNum;
    await addFamilyStock(
      child.id,
      childAddition,
      refId,
      refType,
      notes,
      connection,
      depth + 1
    );
  }
}

/**
 * Synchronizes stock for an entire product family (Parent/Children) during a transfer.
 * If a family member doesn't exist in the target warehouse, it will be created.
 */
export async function syncFamilyStockDuringTransfer(
  transferId: string,
  sourceProductId: string,
  targetWarehouseId: string,
  quantity: number,
  notes: string | undefined,
  connection: PoolConnection
) {
  // 1. Fetch source product info
  const [sourceProducts]: any = await connection.query(
    'SELECT * FROM products WHERE id = ?',
    [sourceProductId]
  );
  if (!sourceProducts || sourceProducts.length === 0) throw new Error('Source product not found');
  const sourceProduct = sourceProducts[0];
  const rootId = sourceProduct.parent_id || sourceProduct.id;

  // 2. Identify ALL Family Members in source warehouse (any depth)
  const sourceFamily = await getAllDescendants(rootId, connection);
  
  // Also include the root itself
  const [rootRows]: any = await connection.query('SELECT * FROM products WHERE id = ?', [rootId]);
  if (rootRows && rootRows.length > 0) {
    sourceFamily.push(rootRows[0]);
  }

  // 3. Fetch Conversion Factors for the family (recursive lookup helper)
  const getFactorToRoot = async (productId: string): Promise<number> => {
    const { factorToRoot } = await findUltimateRoot(productId, connection);
    return factorToRoot;
  };

  // 4. Calculate quantity in Root Units
  const soldItemFactor = await getFactorToRoot(sourceProductId);
  const quantityInRootUnits = quantity / soldItemFactor;

  // 5. Sync each family member
  // Rows come from `SELECT *`, so they carry all product columns even though
  // getAllDescendants types them narrowly — treat as full product rows here.
  for (const sourceMember of sourceFamily as any[]) {
    const memberFactor = await getFactorToRoot(sourceMember.id);
    const memberQtyChange = quantityInRootUnits * memberFactor;
    
    // --- SOURCE Warehouse Update ---
    await updateStockAndRecordMovement(
      sourceMember.id,
      -memberQtyChange,
      'transfer',
      transferId,
      'transfer',
      `Transfer OUT (Family Sync)${notes ? ': ' + notes : ''}`,
      connection
    );

    // --- TARGET Warehouse Update ---
    let targetMemberId = null;
    
    // Primary identification by SKU
    if (sourceMember.sku) {
      const [targetProductsBySku]: any = await connection.query(
        'SELECT id FROM products WHERE sku = ? AND warehouse_id = ?',
        [sourceMember.sku, targetWarehouseId]
      );
      if (targetProductsBySku && targetProductsBySku.length > 0) {
        targetMemberId = targetProductsBySku[0].id;
      }
    }
    
    // Secondary identification by Name
    if (!targetMemberId) {
      const [targetProductsByName]: any = await connection.query(
        'SELECT id FROM products WHERE name = ? AND warehouse_id = ?',
        [sourceMember.name, targetWarehouseId]
      );
      if (targetProductsByName && targetProductsByName.length > 0) {
        targetMemberId = targetProductsByName[0].id;
      }
    }

    if (!targetMemberId) {
      // Create targeted product record
      targetMemberId = `prod_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      await connection.query(
        `INSERT INTO products (
          id, name, description, additional_description, category, brand, subcategory,
          stock, reorder_point, avg_daily_sales, price, cost, sku, barcode, 
          image_url, image_hint, unit_of_measure, parent_id, conversion_factor,
          supplier_id, income_account, expense_account, warehouse_id, 
          vat_status, availability, earns_points, expiration_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetMemberId, sourceMember.name, sourceMember.description,
          sourceMember.additional_description, sourceMember.category, sourceMember.brand,
          sourceMember.subcategory, sourceMember.reorder_point || 0,
          sourceMember.avg_daily_sales || 0, sourceMember.price, sourceMember.cost,
          sourceMember.sku, sourceMember.barcode, sourceMember.image_url,
          sourceMember.image_hint, sourceMember.unit_of_measure, sourceMember.parent_id,
          sourceMember.conversion_factor, sourceMember.supplier_id,
          sourceMember.income_account, sourceMember.expense_account, targetWarehouseId,
          sourceMember.vat_status, sourceMember.availability, sourceMember.earns_points,
          sourceMember.expiration_date
        ]
      );

      // Copy price levels
      const [priceLevels]: any = await connection.query(
          'SELECT price_level_id, price, min_quantity FROM product_price_levels WHERE product_id = ?',
          [sourceMember.id]
      );
      
      if (priceLevels && priceLevels.length > 0) {
          for (const pl of priceLevels) {
              await connection.query(
                  'INSERT INTO product_price_levels (product_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, ?)',
                  [targetMemberId, pl.price_level_id, pl.price, pl.min_quantity]
              );
          }
      }
    }

    await updateStockAndRecordMovement(
      targetMemberId,
      memberQtyChange,
      'transfer',
      transferId,
      'transfer',
      `Transfer IN (Family Sync)${notes ? ': ' + notes : ''}`,
      connection
    );
  }

  return { rootId };
}
