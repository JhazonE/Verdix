import { PoolConnection } from 'mysql2/promise';

export class TransferStockService {
  /**
   * Synchronizes stock for an entire product family (Parent/Children) during a transfer.
   * Logic adapted from lib/family-sync.ts
   */
  async syncFamilyStockDuringTransfer(
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

    // 2. Identify Product Family in source warehouse
    let sourceFamilyQuery = 'SELECT * FROM products WHERE (id = ? OR parent_id = ?) AND warehouse_id = ?';
    let sourceFamilyParams = [rootId, rootId, sourceProduct.warehouse_id];
    
    if (!sourceProduct.warehouse_id) {
      sourceFamilyQuery = 'SELECT * FROM products WHERE (id = ? OR parent_id = ?) AND warehouse_id IS NULL';
      sourceFamilyParams = [rootId, rootId];
    }

    const [sourceFamily]: any = await connection.query(sourceFamilyQuery, sourceFamilyParams);

    // 3. Fetch Conversion Factors for the family
    const [convFactors]: any = await connection.query(
      'SELECT unit, factor FROM conversion_factors WHERE product_id = ?',
      [rootId]
    );

    const getFactorToRoot = (unit: string) => {
      const rootMember = sourceFamily.find((m: any) => m.id === rootId);
      if (rootMember && rootMember.unit_of_measure === unit) return 1;
      const factor = convFactors.find((cf: any) => cf.unit === unit);
      return factor ? parseFloat(factor.factor) : undefined;
    };

    // 4. Calculate quantity in Root Units
    const soldItemFactor = getFactorToRoot(sourceProduct.unit_of_measure) || 1;
    const quantityInRootUnits = quantity / soldItemFactor;

    // 5. Sync each family member
    for (const sourceMember of sourceFamily) {
      const memberFactor = getFactorToRoot(sourceMember.unit_of_measure);
      if (!memberFactor && sourceMember.id !== sourceProductId) continue;
      
      const memberQtyChange = quantityInRootUnits * (memberFactor || 1);
      
      // --- SOURCE Warehouse Update ---
      await this.updateStockAndRecordMovement(
        sourceMember.id,
        sourceMember.name,
        -memberQtyChange,
        'transfer',
        transferId,
        'transfer',
        `Transfer OUT (Family Sync)${notes ? ': ' + notes : ''}`,
        sourceMember.warehouse_id,
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

      await this.updateStockAndRecordMovement(
        targetMemberId,
        sourceMember.name,
        memberQtyChange,
        'transfer',
        transferId,
        'transfer',
        `Transfer IN (Family Sync)${notes ? ': ' + notes : ''}`,
        targetWarehouseId,
        connection
      );
    }
  }

  private async updateStockAndRecordMovement(
    productId: string,
    productName: string,
    quantityChange: number,
    movementType: string,
    referenceId: string,
    referenceType: string,
    notes: string,
    warehouseId: string | null,
    connection: PoolConnection
  ) {
    const [status]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [productId]);
    const previousStock = Number(status[0]?.stock || 0);
    const newStock = previousStock + Number(quantityChange);

    await connection.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, productId]);

    const movementId = `mov_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    await connection.query(
      `INSERT INTO stock_movements (
        id, product_id, product_name, movement_type, quantity_change, previous_stock, new_stock,
        reference_id, reference_type, notes, warehouse_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [movementId, productId, productName, movementType, quantityChange, previousStock, newStock, referenceId, referenceType, notes, warehouseId]
    );
  }
}
