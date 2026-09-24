
import { getProducts, addProduct, addSupplier, addSupplierMapping, deleteProduct, deleteSupplier } from '../app/(app)/products/actions';
import { Product } from '../lib/types';
import { query } from '../lib/mysql';

async function main() {
  console.log('Starting product filter debug script...');

  const timestamp = Date.now();
  const supplierName = `Test Supplier ${timestamp}`;
  const productName = `Test Product ${timestamp}`;
  
  let supplierId: string | undefined;
  let productId: string | undefined;

  try {
    // 1. Create a supplier
    console.log('Creating supplier...');
    const supplierResult = await addSupplier({ name: supplierName });
    if (!supplierResult.success) throw new Error(supplierResult.message);
    // Fetch the supplier ID (hacky since addSupplier doesn't return ID directly in the message easily, but let's check the code)
    // Actually addSupplier returns { success, message }. It generates ID internally: `supplier_${Date.now()}`.
    // We should probably fetch it by name to be sure.
    const suppliers = await query('SELECT id FROM suppliers WHERE name = ?', [supplierName]);
    supplierId = suppliers[0].id;
    console.log('Supplier created with ID:', supplierId);

    // 2. Create a product (without this supplier initially)
    console.log('Creating product...');
    const productResult = await addProduct({
      name: productName,
      brand: 'Test Brand',
      sku: `SKU-${timestamp}`,
      barcode: `BARCODE-${timestamp}`,
      description: 'Test Description',
      category: 'Test Category',
      unitOfMeasure: 'pcs',
      stock: 10,
      reorderPoint: 5,
      price: 100,
    });
    
    if (!productResult.success || !productResult.productId) throw new Error(productResult.message);
    productId = productResult.productId;
    console.log('Product created with ID:', productId);

    // 3. Add a SECONDARY mapping for this supplier
    console.log('Adding secondary supplier mapping...');
    const mappingResult = await addSupplierMapping(
      productId,
      supplierId!,
      5, // lead time
      10, // rop
      80, // cost
      'SUP-SKU',
      false // isPrimary = FALSE
    );
    
    if (!mappingResult.success) throw new Error(mappingResult.message);
    console.log('Mapping added.');

    // 4. Test filtering
    console.log('Testing filter for supplier...');
    const products = await getProducts(10, 0, { supplier: supplierId });
    
    const found = products.some((p: Product) => p.id === productId);
    
    if (found) {
        console.log('SUCCESS: Product found with secondary supplier filter.');
    } else {
        console.error('FAILURE: Product NOT found with secondary supplier filter.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Cleanup
    console.log('Cleaning up...');
    if (productId) await deleteProduct(productId);
    if (supplierId) await deleteSupplier(supplierId);
    console.log('Done.');
    process.exit(0);
  }
}

main();
