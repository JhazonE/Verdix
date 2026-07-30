import { test, expect } from '@playwright/test';

test.describe('Product Price Levels Auto-Calculation', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to products page
    await page.goto('/products');
  });

  test('Add product with price level override should auto-calculate retail base', async ({ page }) => {
    // Click Add Product button
    const addButton = page.locator('button', { hasText: /Add Product/i });
    await addButton.click();

    // Wait for dialog to appear
    await page.waitForSelector('input[placeholder*="Product name"]');

    // Fill basic info
    await page.fill('input[name="name"]', 'Test Product');
    await page.fill('input[name="sku"]', 'TEST-SKU-001');
    await page.fill('input[name="price"]', '100');
    await page.fill('input[name="cost"]', '50');

    // Go to Price Levels tab
    const priceLevelsTab = page.locator('[role="tab"]:has-text("Price Levels")');
    await priceLevelsTab.click();

    // Click Add Level Price
    const addLevelButton = page.locator('button:has-text("Add Level Price")');
    await addLevelButton.click();

    // Select a price level from the dropdown (first dropdown in the new row)
    const levelSelects = page.locator('select').or(page.locator('[role="combobox"]'));
    const firstSelect = levelSelects.first();
    await firstSelect.click();

    // Note: This test assumes a "Wholesale" level exists with +20% adjustment
    // Adjust the selector based on your actual price level names
    await page.locator('[role="option"]:has-text("Wholesale")').click({ force: true });

    // Verify price auto-fills to 120 (100 * 1.20)
    const priceInputs = page.locator('input[type="number"]');
    const lastPriceInput = priceInputs.last();
    const priceValue = await lastPriceInput.inputValue();
    expect(parseFloat(priceValue || '0')).toBe(120);
  });

  test('Changing calculation base should recalculate price', async ({ page }) => {
    // Navigate to add product
    const addButton = page.locator('button', { hasText: /Add Product/i });
    await addButton.click();

    // Setup product
    await page.fill('input[name="name"]', 'Test Product 2');
    await page.fill('input[name="sku"]', 'TEST-SKU-002');
    await page.fill('input[name="price"]', '100');
    await page.fill('input[name="cost"]', '50');

    // Go to Price Levels tab
    const priceLevelsTab = page.locator('[role="tab"]:has-text("Price Levels")');
    await priceLevelsTab.click();

    // Add a price level
    const addLevelButton = page.locator('button:has-text("Add Level Price")');
    await addLevelButton.click();

    // Select level
    const selects = page.locator('[role="combobox"]');
    await selects.first().click();
    await page.locator('[role="option"]:has-text("Wholesale")').click({ force: true });

    // Change calculation base to Cost
    const baseSelects = page.locator('[role="combobox"]');
    await baseSelects.nth(1).click();
    await page.locator('[role="option"]:has-text("Cost Price")').click({ force: true });

    // Verify price recalculated to 60 (50 * 1.20)
    const priceInputs = page.locator('input[type="number"]');
    const lastPriceInput = priceInputs.last();
    const priceValue = await lastPriceInput.inputValue();
    expect(parseFloat(priceValue || '0')).toBe(60);
  });

  test('Changing base price should recalculate all price levels', async ({ page }) => {
    // Navigate to add product
    const addButton = page.locator('button', { hasText: /Add Product/i });
    await addButton.click();

    // Setup product with price level
    await page.fill('input[name="name"]', 'Test Product 3');
    await page.fill('input[name="sku"]', 'TEST-SKU-003');
    await page.fill('input[name="price"]', '100');

    // Go to Price Levels tab and add level
    const priceLevelsTab = page.locator('[role="tab"]:has-text("Price Levels")');
    await priceLevelsTab.click();

    const addLevelButton = page.locator('button:has-text("Add Level Price")');
    await addLevelButton.click();

    const selects = page.locator('[role="combobox"]');
    await selects.first().click();
    await page.locator('[role="option"]:has-text("Wholesale")').click({ force: true });

    // Verify initial price is 120
    const priceInputs = page.locator('input[type="number"]');
    const lastPriceInput = priceInputs.last();
    expect(parseFloat(await lastPriceInput.inputValue() || '0')).toBe(120);

    // Change base price to 150
    const basicInfoTab = page.locator('[role="tab"]:has-text("Basic Info")');
    await basicInfoTab.click();

    const priceInput = page.locator('input[name="price"]');
    await priceInput.clear();
    await priceInput.fill('150');

    // Go back to Price Levels tab
    await priceLevelsTab.click();

    // Verify price level recalculated to 180 (150 * 1.20)
    const updatedPriceInputs = page.locator('input[type="number"]');
    const updatedLastPrice = updatedPriceInputs.last();
    const updatedValue = await updatedLastPrice.inputValue();
    expect(parseFloat(updatedValue || '0')).toBe(180);
  });

  test('Edit product should maintain and recalculate price levels', async ({ page }) => {
    // This test requires an existing product with price levels
    // Navigate to products list
    await page.goto('/products');

    // Click edit on first product (adjust selector based on your UI)
    const editButton = page.locator('button:has-text("Edit")').first();
    await editButton.click();

    // Wait for edit dialog
    await page.waitForSelector('input[name="name"]');

    // Go to Price Levels tab
    const priceLevelsTab = page.locator('[role="tab"]:has-text("Price Levels")');
    await priceLevelsTab.click();

    // Verify price level rows exist
    const priceRows = page.locator('[role="combobox"]');
    const count = await priceRows.count();
    expect(count).toBeGreaterThan(0);

    // Change base price and verify it doesn't error
    const basicInfoTab = page.locator('[role="tab"]:has-text("Basic Info")');
    await basicInfoTab.click();

    const priceInput = page.locator('input[name="price"]');
    const currentValue = await priceInput.inputValue();
    await priceInput.clear();
    await priceInput.fill((parseFloat(currentValue || '0') * 1.5).toString());

    // Go back to price levels - just verify tab loads without error
    await priceLevelsTab.click();

    // Verify rows are still there
    const updatedRows = page.locator('[role="combobox"]');
    const updatedCount = await updatedRows.count();
    expect(updatedCount).toBeGreaterThan(0);
  });
});
