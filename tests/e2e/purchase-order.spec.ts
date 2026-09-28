import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { seedSession, DEFAULT_ADMIN } from './helpers/auth';
import { TEST_SUPPLIER, TEST_WAREHOUSE, TEST_PAYMENT_METHOD, PO_PRODUCT, PO_CASE_PRODUCT, PO_CASE_UNIT } from './fixtures/test-data';

/**
 * Purchase Order (DB-backed) batok sa verdix_test.
 *
 * Coverage:
 *  1. PO creation pinaagi sa API (POST /api/purchase-orders) → na-persist sa DB.
 *  2. UI smoke sa Add Purchase Order dialog: mo-abli ug ma-fill ang header selects.
 *
 * Note: ang in-dialog ProductSelector (custom scan-input nga naka-filter by supplier)
 * dili lig-on i-drive sa e2e — mao nga ang line-item creation gi-test sa API level.
 */

async function selectOption(page: Page, dialog: Locator, label: string, optionName: string) {
  await dialog.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: optionName }).click();
}

test.describe('Purchase order', () => {
  test('PO creation via API → na-persist ug makita sa list', async ({ request }) => {
    const reference = `PO-E2E-${Date.now()}`;

    const res = await request.post('/api/purchase-orders', {
      data: {
        supplierId: TEST_SUPPLIER.id,
        supplierName: TEST_SUPPLIER.name,
        date: new Date().toISOString(),
        paymentMethod: TEST_PAYMENT_METHOD.name,
        purchaseType: 'Order',
        status: 'Pending',
        reference,
        receiveToWarehouse: TEST_WAREHOUSE.id,
        receiveToWarehouseName: TEST_WAREHOUSE.name,
        shipping: 0,
        orderedBy: DEFAULT_ADMIN.displayName,
        items: [
          {
            productId: PO_PRODUCT.id,
            productName: PO_PRODUCT.name,
            quantity: 5,
            cost: PO_PRODUCT.cost,
            sellingPrice: PO_PRODUCT.price,
            discount: 0,
            discountType: 'amount',
            vatSubject: false,
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBeTruthy();

    // I-verify nga makita ang PO sa list (gi-pangita pinaagi sa reference).
    await expect(async () => {
      const listRes = await request.get(`/api/purchase-orders?search=${reference}&limit=50`);
      const listBody = await listRes.json();
      const match = (listBody.data ?? []).find((po: any) => po.referenceNumber === reference);
      expect(match, 'PO makita sa list pinaagi sa reference').toBeTruthy();
      expect(match.supplierName).toBe(TEST_SUPPLIER.name);
    }).toPass({ timeout: 10_000 });
  });

  test('Receive PO: "highest wins" rule sa cost ug retail price', async ({ request }) => {
    // Dedicated product para dili ma-coupled sa laing test nga mo-mutate sa PO_PRODUCT.
    const productId = `hw-prod-${Date.now()}`;
    const sku = `HW-${Date.now()}`;
    const startCost = 50;
    const startPrice = 100;

    const createRes = await request.post('/api/products', {
      data: {
        id: productId,
        name: `Highest-Wins Item ${Date.now()}`,
        sku,
        price: startPrice,
        cost: startCost,
        stock: 0,
        supplierId: TEST_SUPPLIER.id,
      },
    });
    expect(createRes.ok(), 'product created').toBeTruthy();

    // Helper: auto-receive a PO (purchaseType 'Receive' → processPurchaseOrderReceipt fires)
    // ug ibalik ang na-persist nga product cost/price.
    const receiveAndRead = async (cost: number, sellingPrice: number) => {
      const res = await request.post('/api/purchase-orders', {
        data: {
          supplierId: TEST_SUPPLIER.id,
          supplierName: TEST_SUPPLIER.name,
          date: new Date().toISOString(),
          paymentMethod: TEST_PAYMENT_METHOD.name,
          purchaseType: 'Receive',
          status: 'Received',
          reference: `PO-HW-${Date.now()}`,
          receiveToWarehouse: TEST_WAREHOUSE.id,
          receiveToWarehouseName: TEST_WAREHOUSE.name,
          shipping: 0,
          orderedBy: DEFAULT_ADMIN.displayName,
          items: [
            {
              productId,
              productName: 'Highest-Wins Item',
              quantity: 1,
              cost,
              sellingPrice,
              discount: 0,
              discountType: 'amount',
              vatSubject: false,
            },
          ],
        },
      });
      expect(res.ok(), 'PO received').toBeTruthy();
      expect((await res.json()).success).toBeTruthy();

      const listRes = await request.get(`/api/products?search=${sku}&limit=5`);
      const listBody = await listRes.json();
      const prod = (listBody.data ?? []).find((p: any) => p.id === productId);
      expect(prod, 'product makita sa list').toBeTruthy();
      return { cost: Number(prod.cost), price: Number(prod.price) };
    };

    // 1. Higher cost + higher price → mo-saka ang duha.
    const afterHigher = await receiveAndRead(70, 130);
    expect(afterHigher.cost).toBe(70);
    expect(afterHigher.price).toBe(130);

    // 2. Lower cost + lower price → dili mo-ubos (highest wins). Magpabilin sa 70 / 130.
    const afterLower = await receiveAndRead(40, 90);
    expect(afterLower.cost).toBe(70);
    expect(afterLower.price).toBe(130);
  });

  test('Receive PO by selling unit: Case quantity/cost convert to base-unit pieces', async ({ request }) => {
    const reference = `PO-CASE-E2E-${Date.now()}`;

    const res = await request.post('/api/purchase-orders', {
      data: {
        supplierId: TEST_SUPPLIER.id,
        supplierName: TEST_SUPPLIER.name,
        date: new Date().toISOString(),
        paymentMethod: TEST_PAYMENT_METHOD.name,
        purchaseType: 'Receive',
        status: 'Received',
        reference,
        receiveToWarehouse: TEST_WAREHOUSE.id,
        receiveToWarehouseName: TEST_WAREHOUSE.name,
        shipping: 0,
        orderedBy: DEFAULT_ADMIN.displayName,
        items: [
          {
            productId: PO_CASE_PRODUCT.id,
            productName: PO_CASE_PRODUCT.name,
            quantity: 2, // 2 Cases
            cost: PO_CASE_UNIT.cost, // ₱60/Case
            sellingPrice: PO_CASE_UNIT.price, // ₱100/Case
            discount: 0,
            discountType: 'amount',
            vatSubject: false,
            sellingUnitId: PO_CASE_UNIT.id,
            sellingUnitName: PO_CASE_UNIT.name,
            sellingUnitFactor: PO_CASE_UNIT.factor,
          },
        ],
      },
    });
    expect(res.ok(), 'PO received').toBeTruthy();
    expect((await res.json()).success).toBeTruthy();

    // 2 Cases * factor 24 = 48 pieces landed in base-unit stock.
    const listRes = await request.get(`/api/products?search=${PO_CASE_PRODUCT.sku}&limit=5`);
    const listBody = await listRes.json();
    const prod = (listBody.data ?? []).find((p: any) => p.id === PO_CASE_PRODUCT.id);
    expect(prod, 'product makita sa list').toBeTruthy();
    expect(Number(prod.stock)).toBe(48);

    // ₱60/Case * 2 / 24 pcs = ₱2.50/pc landed cost. Starting cost was ₱3 (PO_CASE_PRODUCT.cost),
    // so "highest wins" keeps the higher existing cost of ₱3 rather than dropping to ₱2.50.
    expect(Number(prod.cost)).toBe(PO_CASE_PRODUCT.cost);

    // ₱100/Case ÷ 24 ≈ ₱4.17/pc, lower than the existing price of ₱5 — highest wins keeps ₱5.
    expect(Number(prod.price)).toBe(PO_CASE_PRODUCT.price);
  });

  test('Receive PO with mixed base-unit and Case lines: shipping splits per line, not per piece', async ({ request }) => {
    // Two lines on one PO, one Piece (PO_PRODUCT) and one Case (PO_CASE_PRODUCT),
    // with a shipping fee. calculatePurchaseCosts splits shipping "equally by
    // number of item lines" (2 lines -> ₱10 each), regardless of how many base
    // units each line resolves to — this must survive the factor conversion.
    const reference = `PO-MIXED-E2E-${Date.now()}`;
    const shipping = 20;

    const res = await request.post('/api/purchase-orders', {
      data: {
        supplierId: TEST_SUPPLIER.id,
        supplierName: TEST_SUPPLIER.name,
        date: new Date().toISOString(),
        paymentMethod: TEST_PAYMENT_METHOD.name,
        purchaseType: 'Receive',
        status: 'Received',
        reference,
        receiveToWarehouse: TEST_WAREHOUSE.id,
        receiveToWarehouseName: TEST_WAREHOUSE.name,
        shipping,
        orderedBy: DEFAULT_ADMIN.displayName,
        items: [
          {
            productId: PO_PRODUCT.id,
            productName: PO_PRODUCT.name,
            quantity: 1,
            cost: PO_PRODUCT.cost, // ₱18/pc, no selling unit -> factor defaults to 1
            sellingPrice: PO_PRODUCT.price,
            discount: 0,
            discountType: 'amount',
            vatSubject: false,
          },
          {
            productId: PO_CASE_PRODUCT.id,
            productName: PO_CASE_PRODUCT.name,
            quantity: 1, // 1 Case
            cost: PO_CASE_UNIT.cost, // ₱60/Case
            sellingPrice: PO_CASE_UNIT.price,
            discount: 0,
            discountType: 'amount',
            vatSubject: false,
            sellingUnitId: PO_CASE_UNIT.id,
            sellingUnitName: PO_CASE_UNIT.name,
            sellingUnitFactor: PO_CASE_UNIT.factor,
          },
        ],
      },
    });
    expect(res.ok(), 'PO received').toBeTruthy();
    expect((await res.json()).success).toBeTruthy();

    // Piece line: ₱18 cost + ₱10 shipping (half of ₱20, split by line count) = ₱28/pc landed.
    // PO_PRODUCT is confirmed pristine at this point in the file (cost:18) — neither of the
    // two earlier tests in this spec mutates products.cost/.price: the first test uses
    // purchaseType 'Order' (never reaches processPurchaseOrderReceipt, which is the only
    // place cost/price get written), and the "highest wins" test operates on its own
    // dedicated `hw-prod-*` product, not PO_PRODUCT. So the existing cost (18) is lower
    // than the new landed cost (28), and "highest wins" lets it rise to 28.
    const pieceListRes = await request.get(`/api/products?search=${PO_PRODUCT.sku}&limit=5`);
    const pieceProd = ((await pieceListRes.json()).data ?? []).find((p: any) => p.id === PO_PRODUCT.id);
    expect(pieceProd, 'piece product makita sa list').toBeTruthy();
    expect(Number(pieceProd.cost)).toBeCloseTo(28, 2);

    // Case line: (₱60 cost + ₱10 shipping) / 24 pcs-per-Case = ₱2.9166.../pc landed.
    // This is run AFTER the Case-only test above already raised PO_CASE_PRODUCT's cost
    // to ₱3 in this same file (both tests use purchaseType 'Receive', which does mutate
    // cost/price) — and even measured against the ORIGINAL fixture cost of ₱3, ₱2.9166...
    // is still lower. Either way, "highest wins" keeps the existing ₱3 rather than
    // dropping to the new landed cost.
    const caseListRes = await request.get(`/api/products?search=${PO_CASE_PRODUCT.sku}&limit=5`);
    const caseProd = ((await caseListRes.json()).data ?? []).find((p: any) => p.id === PO_CASE_PRODUCT.id);
    expect(caseProd, 'case product makita sa list').toBeTruthy();
    expect(Number(caseProd.cost)).toBe(PO_CASE_PRODUCT.cost);
  });

  test('UI smoke: Add Purchase Order dialog mo-abli ug ma-fill ang header', async ({ page }) => {
    await seedSession(page, DEFAULT_ADMIN);
    await page.goto('/purchases');

    // Ang /purchases mo-load nga walay infinite-loop crash (useProducts stable-array fix).
    await page.getByRole('button', { name: 'Add New Purchase Order' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Create Order' })).toBeVisible();

    // Header selects molihok (supplier/payment/warehouse).
    await selectOption(page, dialog, 'Supplier', TEST_SUPPLIER.name);
    await selectOption(page, dialog, 'Payment Method', TEST_PAYMENT_METHOD.name);
    await selectOption(page, dialog, 'Receive To', TEST_WAREHOUSE.name);

    await expect(dialog.getByRole('combobox', { name: 'Supplier' })).toContainText(TEST_SUPPLIER.name);
    await expect(dialog.getByRole('combobox', { name: 'Payment Method' })).toContainText(TEST_PAYMENT_METHOD.name);
    await expect(dialog.getByRole('combobox', { name: 'Receive To' })).toContainText(TEST_WAREHOUSE.name);
  });
});
