import { query } from '../../../lib/mysql';
import { ProductRepository, GetProductsFilters } from '../../core/products/domain/IProductRepository';
import { ProductEntity } from '../../core/products/domain/Product';

export class MySqlProductRepository implements ProductRepository {
  async findAll(limit: number, offset: number, filters: GetProductsFilters): Promise<ProductEntity[]> {
    let sql = `
      SELECT
        products.id,
        products.name,
        products.description,
        products.category,
        products.brand,
        products.department,
        products.stock,
        products.type,
        products.price,
        products.cost,
        products.sku,
        products.barcode,
        products.vat_status as vatStatus,
        products.availability,
        COALESCE(uom.abbreviation, products.unit_of_measure) as unitOfMeasure,
        products.reorder_point as reorderPoint,
        products.avg_daily_sales as avgDailySales,
        products.expiration_date as expirationDate,
        products.warehouse_id as warehouseId,
        (SELECT GROUP_CONCAT(shelf_id) FROM product_shelves WHERE product_id = products.id) as shelfLocationIds,
        (SELECT GROUP_CONCAT(CONCAT(shelf_id, ':', quantity)) FROM product_shelves WHERE product_id = products.id) as shelfQuantitiesRaw,
        products.updated_at as updatedAt,
        products.parent_id as parentId,
        products.conversion_factor as conversionFactor
      FROM products
      -- products.unit_of_measure is free text with no FK, and rows hold a mix
      -- of unit names ('Pieces') and abbreviations ('pcs'). Matching on name
      -- alone missed every abbreviation-valued row, so COALESCE above fell back
      -- to the raw string and the column never showed a real abbreviation.
      LEFT JOIN units_of_measure uom
        ON products.unit_of_measure = uom.name
        OR products.unit_of_measure = uom.abbreviation
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filters.category) {
      sql += ' AND products.category = ?';
      params.push(filters.category);
    }
    
    if (filters.department) {
      sql += ' AND products.department = ?';
      params.push(filters.department);
    }

    if (filters.search) {
      // A selling unit's own barcode (e.g. a Pack of 12) is invisible to a
      // scanner otherwise — it only exists in product_selling_units, never on
      // products.barcode itself. Without this, a scan only resolves for
      // products already sitting in the client's small local cache page;
      // everything else in the catalog silently fails to be found.
      sql += ` AND (
        products.name LIKE ? OR products.sku LIKE ? OR products.barcode LIKE ?
        OR EXISTS (
          SELECT 1 FROM product_selling_units su
          WHERE su.product_id = products.id AND su.barcode LIKE ?
        )
      )`;
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }

    if (filters.warehouseId) {
      sql += ' AND products.warehouse_id = ?';
      params.push(filters.warehouseId);
    }

    if (filters.availability) {
      sql += ' AND products.availability = ?';
      params.push(filters.availability);
    }

    // Screens that can only act on stock they have (the transfer and shelf
    // boards) ask for this. It MUST be applied in SQL, before the LIMIT:
    // filtering in JS afterwards would let a page of out-of-stock rows consume
    // the whole limit and hide the items the caller actually wanted — the
    // original transfer-board bug, where 2 of 4 in-stock products showed.
    if (filters.inStock) {
      sql += ' AND products.stock > 0';
    }

    if (filters.supplierId) {
      sql += ' AND (products.supplier_id = ? OR EXISTS (SELECT 1 FROM supplier_product_mapping spm WHERE spm.product_id = products.id AND spm.supplier_id = ?))';
      params.push(filters.supplierId, filters.supplierId);
    }
    
    if (filters.shelfId) {
      sql += ' AND EXISTS (SELECT 1 FROM product_shelves WHERE product_id = products.id AND shelf_id = ?)';
      params.push(filters.shelfId);
    } else if (filters.shelfLocationId) {
      sql += ' AND EXISTS (SELECT 1 FROM product_shelves WHERE product_id = products.id AND shelf_id = ?)';
      params.push(filters.shelfLocationId);
    }

    sql += ' ORDER BY products.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const products = await query(sql, params);

    if (products.length > 0) {
      // Fetch default price level for effective price calculation
      const defaultPriceLevelSql = `SELECT id FROM price_levels WHERE is_default = 1 LIMIT 1`;
      const defaultPriceLevelResult = await query(defaultPriceLevelSql);
      const defaultLevelId = defaultPriceLevelResult.length > 0 ? defaultPriceLevelResult[0].id : null;

      const productIds = products.map((p: any) => p.id);

      // product_price_levels was dropped when price levels moved to being
      // per-selling-unit instead of per-product. Fetch selling units and their
      // per-level overrides instead, mirroring actions.ts's getProducts.
      const suSql = `SELECT * FROM product_selling_units WHERE product_id IN (?)`;
      const sellingUnitRows = await query(suSql, [productIds]);
      const sellingUnitIds = sellingUnitRows.map((u: any) => u.id);

      const sulpByUnit = new Map<string, any[]>();
      if (sellingUnitIds.length > 0) {
        const sulpSql = `SELECT * FROM product_selling_unit_price_levels WHERE selling_unit_id IN (?)`;
        const sulpRows = await query(sulpSql, [sellingUnitIds]);
        for (const row of sulpRows) {
          if (!sulpByUnit.has(row.selling_unit_id)) sulpByUnit.set(row.selling_unit_id, []);
          sulpByUnit.get(row.selling_unit_id)!.push({
            levelId: row.price_level_id,
            price: Number(row.price),
            minQuantity: row.min_quantity ?? 0,
          });
        }
      }

      const suByProduct = new Map<string, any[]>();
      for (const u of sellingUnitRows) {
        if (!suByProduct.has(u.product_id)) suByProduct.set(u.product_id, []);
        suByProduct.get(u.product_id)!.push({
          id: u.id,
          name: u.name,
          factor: Number(u.factor),
          barcode: u.barcode ?? undefined,
          cost: u.cost !== null ? Number(u.cost) : undefined,
          price: Number(u.price),
          isBase: !!u.is_base,
          priceLevels: sulpByUnit.get(u.id) ?? [],
        });
      }

      products.forEach((product: any) => {
        product.sellingUnits = suByProduct.get(product.id) ?? [];

        if (product.shelfLocationIds) {
          product.shelfLocationIds = product.shelfLocationIds.split(',');
        } else {
          product.shelfLocationIds = [];
        }

        product.shelfQuantities = {};
        if (product.shelfQuantitiesRaw) {
          product.shelfQuantitiesRaw.split(',').forEach((s: string) => {
            const [id, qty] = s.split(':');
            product.shelfQuantities[id] = parseInt(qty) || 0;
          });
        }
        delete product.shelfQuantitiesRaw;

        if (defaultLevelId) {
            const baseUnit = product.sellingUnits.find((u: any) => u.isBase);
            const baseOverrides = (baseUnit?.priceLevels ?? [])
                .filter((pl: any) => pl.levelId === defaultLevelId)
                .sort((a: any, b: any) => (a.minQuantity || 0) - (b.minQuantity || 0));

            if (baseOverrides.length > 0) {
                product.price = baseOverrides[0].price;
            }
        }
      });
    }

    return products;
  }

  async countAll(filters: GetProductsFilters): Promise<number> {
    let countSql = 'SELECT COUNT(*) as total FROM products WHERE 1=1';
    const countParams: any[] = [];

    if (filters.category) {
      countSql += ' AND category = ?';
      countParams.push(filters.category);
    }

    if (filters.department) {
      countSql += ' AND department = ?';
      countParams.push(filters.department);
    }

    if (filters.search) {
      // Mirrors findAll's search clause, including the selling-unit barcode
      // check — otherwise a scan that resolves a product via its Pack
      // barcode would report a total/hasMore that disagrees with the rows
      // findAll actually returns.
      countSql += ` AND (
        name LIKE ? OR sku LIKE ? OR barcode LIKE ?
        OR EXISTS (
          SELECT 1 FROM product_selling_units su
          WHERE su.product_id = products.id AND su.barcode LIKE ?
        )
      )`;
      countParams.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }

    if (filters.warehouseId) {
      countSql += ' AND warehouse_id = ?';
      countParams.push(filters.warehouseId);
    }

    if (filters.availability) {
      countSql += ' AND availability = ?';
      countParams.push(filters.availability);
    }

    // Must mirror findAll's inStock clause, or the reported total disagrees
    // with the rows actually returned and hasMore lies.
    if (filters.inStock) {
      countSql += ' AND stock > 0';
    }

    if (filters.supplierId) {
       countSql += ' AND (supplier_id = ? OR EXISTS (SELECT 1 FROM supplier_product_mapping spm WHERE spm.product_id = products.id AND spm.supplier_id = ?))';
       countParams.push(filters.supplierId, filters.supplierId);
    }
    
    if (filters.shelfId) {
      countSql += ' AND EXISTS (SELECT 1 FROM product_shelves WHERE product_id = products.id AND shelf_id = ?)';
      countParams.push(filters.shelfId);
    } else if (filters.shelfLocationId) {
      countSql += ' AND EXISTS (SELECT 1 FROM product_shelves WHERE product_id = products.id AND shelf_id = ?)';
      countParams.push(filters.shelfLocationId);
    }

    const countResult = await query(countSql, countParams);
    return countResult[0]?.total || 0;
  }

  async findById(id: string): Promise<ProductEntity | null> {
    const results = await this.findAll(1, 0, { search: id }); // Overly simplified for now
    // Actually search should be by ID here
    const productSql = `SELECT *, parent_id as parentId, conversion_factor as conversionFactor FROM products WHERE id = ?`;
    const rows = await query(productSql, [id]);
    if (rows.length === 0) return null;
    
    // We would also need price levels for a single product... 
    // For brevity, let's reuse a more specific method or implement properly later.
    const products = await this.findAll(1, 0, { search: rows[0].sku }); // Hacky
    return products[0] || null;
  }

  async create(product: Partial<ProductEntity>): Promise<string> {
    const id = product.id || `prod_${Date.now()}`;
    const sql = `
      INSERT INTO products (
        id, name, description, category, brand, department, stock, price, cost, sku, barcode, reorder_point, avg_daily_sales
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await query(sql, [
      id, product.name, product.description, product.category, product.brand, product.department,
      product.stock || 0, product.price, product.cost, product.sku, product.barcode, 0, 0
    ]);

    // POST /api/products (CreateProductUseCase) IS a live, E2E-tested caller
    // of this method — it is not the app's primary product-creation path
    // (that's app/(app)/products/actions.ts's addProduct server action), but
    // it is reachable, and its request DTO still declares an optional
    // priceLevels field. The old `INSERT INTO product_price_levels` here
    // wrote to a table Task 1 dropped; price levels are now per-selling-unit
    // (product_selling_unit_price_levels), which requires an existing
    // selling_unit_id (FK). Every product needs a base selling unit anyway
    // (factor 1, is_base = 1) or it is unsellable and reads back with an
    // empty sellingUnits array — create it unconditionally here, then attach
    // any submitted price levels to it, so a priceLevels payload from this
    // path is no longer silently dropped.
    const baseUnitId = `psu_base_${id}`;
    await query(
      `INSERT INTO product_selling_units (id, product_id, name, barcode, factor, cost, price, is_base)
       VALUES (?, ?, ?, ?, 1, ?, ?, 1)`,
      [baseUnitId, id, product.unitOfMeasure || 'Piece', product.barcode || null, product.cost, product.price],
    );

    if (product.priceLevels && product.priceLevels.length > 0) {
      for (const pl of product.priceLevels) {
        await query(
          'INSERT INTO product_selling_unit_price_levels (selling_unit_id, price_level_id, price, min_quantity) VALUES (?, ?, ?, ?)',
          [baseUnitId, pl.levelId, pl.price, pl.minQuantity || 0],
        );
      }
    }

    if (product.shelfLocationIds && product.shelfLocationIds.length > 0) {
      for (let i = 0; i < product.shelfLocationIds.length; i++) {
        const shelfId = product.shelfLocationIds[i];
        const qty = i === 0 ? (product.stock || 0) : 0;
        await query('INSERT INTO product_shelves (product_id, shelf_id, quantity) VALUES (?, ?, ?)', [id, shelfId, qty]);
      }
    }

    return id;
  }

  async update(id: string, product: Partial<ProductEntity>): Promise<void> {
    // Basic implementation
    const updates: string[] = [];
    const params: any[] = [];
    
    Object.entries(product).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'priceLevels') {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    });
    
    if (updates.length > 0) {
      const sql = `UPDATE products SET ${updates.join(', ')} WHERE id = ?`;
      params.push(id);
      await query(sql, params);
    }

    if (product.shelfLocationIds) {
      const [currentShelves]: any = await query('SELECT shelf_id, quantity FROM product_shelves WHERE product_id = ?', [id]);
      const currentQtyMap = new Map(currentShelves.map((s: any) => [s.shelf_id, s.quantity]));

      await query('DELETE FROM product_shelves WHERE product_id = ?', [id]);
      for (let i = 0; i < product.shelfLocationIds.length; i++) {
        const shelfId = product.shelfLocationIds[i];
        let qty = currentQtyMap.get(shelfId) || 0;
        
        // If product was previously unassigned and now has shelves, move all stock to the first one
        if (currentShelves.length === 0 && i === 0) {
          qty = product.stock || 0;
        }
        
        await query('INSERT INTO product_shelves (product_id, shelf_id, quantity) VALUES (?, ?, ?)', [id, shelfId, qty]);
      }
    }
  }

  async delete(id: string): Promise<void> {
    await query(`DELETE FROM products WHERE id = ?`, [id]);
  }
}
