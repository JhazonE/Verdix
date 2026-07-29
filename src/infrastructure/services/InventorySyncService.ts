import { PoolConnection } from 'mysql2/promise';

export class InventorySyncService {
  async deductStockWithFamilySync(
    item: { productId: string; quantity: number },
    referenceId: string,
    referenceNote: string,
    connection: PoolConnection
  ): Promise<void> {
    // Fetch sold product details to identify family
    const [soldProdResult]: any = await connection.query(
      'SELECT id, parent_id, unit_of_measure, name, stock FROM products WHERE id = ?', 
      [item.productId]
    );
    
    if (!soldProdResult || soldProdResult.length === 0) {
      throw new Error(`Product not found: ${item.productId}`);
    }

    const soldProd = soldProdResult[0];
    const rootId = soldProd.parent_id || soldProd.id;

    // 1. Identify Product Family (Root + all children)
    const [familyMembers]: any = await connection.query(`
          SELECT id, unit_of_measure, name, stock 
          FROM products 
          WHERE id = ? OR parent_id = ?
      `, [rootId, rootId]);

    // 2. Fetch conversion factors relative to the ROOT product
    // Wait, the original logic fetched conversion factors for the sold product if it's the anchor?
    // Let's re-read: "Fetch conversion factors relative to the SOLD product (our anchor)"
    const [convFactors]: any = await connection.query(
      'SELECT unit, factor FROM conversion_factors WHERE product_id = ?', 
      [item.productId]
    );
    
    const factorMap = new Map();
    convFactors.forEach((cf: any) => factorMap.set(cf.unit, parseFloat(cf.factor)));
    factorMap.set(soldProd.unit_of_measure, 1);

    // 3. Define the "Anchor" new stock
    const anchorPreviousStock = Number(soldProd.stock || 0);
    const anchorNewStock = anchorPreviousStock - item.quantity;

    // 4. Force-update all family members based on the anchor's new state
    for (const member of familyMembers) {
      let factor = factorMap.get(member.unit_of_measure);
      if (factor !== undefined) {
        const currentStock = Number(member.stock || 0);
        const newStock = Math.floor(anchorNewStock * factor);
        const quantityChange = newStock - currentStock;

        if (quantityChange !== 0 || member.id === soldProd.id) {
          // Record stock movement
          const movementId = `mov_${Date.now()}_${member.id.substr(-4)}_${Math.random().toString(36).substr(2, 5)}`;
          const insertMovementSql = `
                    INSERT INTO stock_movements (
                        id, product_id, product_name, movement_type,
                        quantity_change, previous_stock, new_stock,
                        reference_id, reference_type, notes
                    ) VALUES (?, ?, ?, 'sale', ?, ?, ?, ?, 'sale', ?)
                `;

          await connection.query(insertMovementSql, [
            movementId,
            member.id,
            member.name,
            quantityChange,
            currentStock,
            newStock,
            referenceId,
            referenceNote
          ]);

          // Update product stock
          await connection.query('UPDATE products SET stock = ?, updated_at = NOW() WHERE id = ?', [newStock, member.id]);
        }
      }
    }
  }

  async checkStockAvailability(productId: string, requestedQuantity: number, connection: PoolConnection): Promise<void> {
    const [settingsResult]: any = await connection.query('SELECT enable_negative_inventory FROM pos_settings LIMIT 1');
    const enableNegativeInventory = settingsResult.length > 0 ? !!settingsResult[0].enable_negative_inventory : false;

    if (!enableNegativeInventory) {
        const [stockResult]: any = await connection.query('SELECT stock, name FROM products WHERE id = ?', [productId]);
        if (stockResult && stockResult.length > 0) {
            const currentStock = stockResult[0].stock;
            if (currentStock < requestedQuantity) {
                 throw new Error(`Insufficient stock for product: ${stockResult[0].name}. Current stock: ${currentStock}, Requested: ${requestedQuantity}`);
            }
        }
    }
  }
}
