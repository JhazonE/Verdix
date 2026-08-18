 
async function verifyPurchaseOrder() {
  const baseUrl = 'http://localhost:3000/api/purchase-orders';
  const productsUrl = 'http://localhost:3000/api/products?limit=1';
  const suppliersUrl = 'http://localhost:3000/api/suppliers';

  try {
    // 1. Fetch Product
    console.log('Fetching product...');
    const prodRes = await fetch(productsUrl);
    const prodJson = await prodRes.json();
    if (!prodJson.data || prodJson.data.length === 0) {
      console.error('No products found. Cannot verify.');
      return;
    }
    const product = prodJson.data[0];
    console.log('Using Product:', product.name, product.id);

    // 2. Fetch Supplier
    console.log('Fetching supplier...');
    const suppRes = await fetch(suppliersUrl);
    const suppJson = await suppRes.json();
    if (!suppJson.data || suppJson.data.length === 0) {
      console.error('No suppliers found. Cannot verify.');
      return;
    }
    const supplier = suppJson.data[0];
    console.log('Using Supplier:', supplier.name, supplier.id);

    // 3. Create PO
    const payload = {
        supplierId: supplier.id,
        supplierName: supplier.name,
        date: new Date().toISOString(),
        items: [
          {
            productId: product.id,
            productName: product.name,
            quantity: 5,
            cost: 100
          }
        ],
        total: 500,
        paymentMethod: 'Cash',
        status: 'Pending'
    };

    console.log('Testing create PO...');
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log('Status:', response.status);
    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('SUCCESS: Purchase Order created!');
    } else {
      console.log('FAILURE: ' + result.error);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

verifyPurchaseOrder();
