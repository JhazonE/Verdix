/**
 * Centralized test fixtures — gigamit sa prepare-test-db.ts (pag-seed) ug sa mga
 * spec (pag-assert). Usa ra ka source of truth para sa known test data.
 */

export const BUSINESS_NAME = 'Verdix Test Store';

export const TEST_PASSWORD = 'Test@1234';

export type TestUser = {
  uid: string;
  username: string;
  password: string;
  displayName: string;
  userType: 'Admin' | 'Cashier';
};

export const TEST_USERS: Record<'admin' | 'cashier', TestUser> = {
  admin: {
    uid: 'test-admin-uid',
    username: 'test.admin',
    password: TEST_PASSWORD,
    displayName: 'Test Admin',
    userType: 'Admin',
  },
  cashier: {
    uid: 'test-cashier-uid',
    username: 'test.cashier',
    password: TEST_PASSWORD,
    displayName: 'Test Cashier',
    userType: 'Cashier',
  },
};

export type TestProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
  sku: string;
  barcode: string;
};

export const TEST_PRODUCTS: TestProduct[] = [
  { id: 'test-prod-1', name: 'Test Coffee 3-in-1', price: 12.5, stock: 100, sku: 'TST-COF-001', barcode: '4800000000017' },
  { id: 'test-prod-2', name: 'Test Bottled Water 500ml', price: 20, stock: 250, sku: 'TST-WTR-002', barcode: '4800000000024' },
  { id: 'test-prod-3', name: 'Test Instant Noodles', price: 15.75, stock: 80, sku: 'TST-NDL-003', barcode: '4800000000031' },
];

/** POS terminal — ip 127.0.0.1 aron auto-match sa local test client; fallback usab
 * isip terminalsData[0] kay kini ra ang terminal.
 *
 * location MUST be '' (walay inventory location). Ang POS mo-filter sa products
 * pinaagi sa terminal.location → products.warehouse_id; ang atong test products
 * naa'y NULL warehouse_id, mao nga ang bisan unsang location mo-exclude nila. */
export const TEST_TERMINAL = {
  id: 'test-terminal-1',
  name: 'Test Counter 1',
  location: '',
  ipAddress: '127.0.0.1',
};

/** Cash payment method para sa tender flow. */
export const TEST_PAYMENT_METHOD = {
  id: 'pm-cash',
  name: 'Cash',
};

/** Product-option master data — gikinahanglan sa Add Product form (mga dropdown). */
export const TEST_BRAND = { id: 'brand-test', name: 'Test Brand' };
export const TEST_CATEGORY = { id: 'cat-test', name: 'Test Category' };
export const TEST_UNIT = { id: 'uom-piece', name: 'Piece', abbreviation: 'pcs' };
/** Default retail price level — ang form mo-sync sa main price gikan sa default level. */
export const TEST_PRICE_LEVEL = { id: 'retail-level', name: 'Retail', isDefault: true };

/** Bag-ong product nga himuon sa Add Product UI test. */
export const NEW_PRODUCT = {
  name: 'QA Test Widget',
  sku: 'QA-WIDGET-001',
  description: 'A widget created by the e2e Add Product test.',
  price: 99.5,
  stock: 42,
};

/**
 * Dedicated nga products para sa edit/delete tests — kompleto ang required fields
 * (brand/category/description/unit) aron mo-pasar ang edit form validation, ug
 * hilit gikan sa TEST_PRODUCTS aron walay cross-spec coupling.
 */
export type FullProduct = {
  id: string;
  name: string;
  sku: string;
  description: string;
  price: number;
  stock: number;
  brand: string;
  category: string;
  unitOfMeasure: string;
};

export const EDITABLE_PRODUCT: FullProduct = {
  id: 'test-editable-1',
  name: 'Editable Widget',
  sku: 'EDIT-ME-001',
  description: 'Product para edit-on sa e2e test.',
  price: 50,
  stock: 30,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: TEST_UNIT.name,
};

export const DELETABLE_PRODUCT: FullProduct = {
  id: 'test-deletable-1',
  name: 'Deletable Widget',
  sku: 'DELETE-ME-001',
  description: 'Product para delete-on sa e2e test.',
  price: 60,
  stock: 20,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: TEST_UNIT.name,
};

/** Dedicated nga product para sa inventory stock-adjustment test. */
export const INVENTORY_PRODUCT: FullProduct = {
  id: 'test-inventory-1',
  name: 'Inventory Stock Item',
  sku: 'INV-ADJ-001',
  description: 'Product para sa stock-adjustment test.',
  price: 10,
  stock: 100,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: TEST_UNIT.name,
};

/**
 * Dedicated nga PERISHABLE product para sa expiration-date test. Bulag gikan sa
 * INVENTORY_PRODUCT aron ang is_perishable flag dili makaguba sa existing
 * inventory-adjust spec (nga wala nagdahom ug expiry field sa dialog).
 */
export const PERISHABLE_PRODUCT: FullProduct = {
  id: 'test-perishable-1',
  name: 'Perishable Stock Item',
  sku: 'PERISH-001',
  description: 'Product para sa expiration-date test.',
  price: 45,
  stock: 50,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: TEST_UNIT.name,
};

/**
 * Family para sa child-reassignment test. REASSIGN_PARENT_A is the current mother of
 * REASSIGN_CHILD (unit "Piece", factor 12 per box). REASSIGN_PARENT_B is an unrelated
 * top-level product the child gets moved under.
 */
export const REASSIGN_PARENT_A: FullProduct = {
  id: 'test-reassign-parent-a',
  name: 'Reassign Parent A',
  sku: 'RSN-PAR-A-001',
  description: 'Original mother product para sa reassign test.',
  price: 120,
  stock: 10,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Box',
};

export const REASSIGN_PARENT_B: FullProduct = {
  id: 'test-reassign-parent-b',
  name: 'Reassign Parent B',
  sku: 'RSN-PAR-B-001',
  description: 'New mother product para sa reassign test.',
  price: 150,
  stock: 5,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Box',
};

export const REASSIGN_CHILD: FullProduct & { parentId: string } = {
  id: 'test-reassign-child',
  name: 'Reassign Child Piece',
  sku: 'RSN-CHD-001',
  description: 'Child unit nga i-reassign.',
  price: 12,
  stock: 0,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Piece',
  parentId: REASSIGN_PARENT_A.id,
};

/**
 * Dedicated family para sa TOP-LEVEL reassignment test. REASSIGN_TOP_MOVER is a
 * top-level (parent_id NULL) mother nga naay usa ka anak (REASSIGN_TOP_MOVER_CHILD,
 * unit "Piece", factor 6). REASSIGN_TOP_TARGET is an unrelated top-level product nga
 * padulngan sa mover. Bulag ni sa REASSIGN_PARENT_* family aron walay cross-test coupling.
 */
export const REASSIGN_TOP_MOVER: FullProduct = {
  id: 'test-reassign-top-mover',
  name: 'Reassign Top Mover',
  sku: 'RSN-TOP-MVR-001',
  description: 'Top-level mother nga i-move under a new parent.',
  price: 200,
  stock: 8,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Box',
};

export const REASSIGN_TOP_TARGET: FullProduct = {
  id: 'test-reassign-top-target',
  name: 'Reassign Top Target',
  sku: 'RSN-TOP-TGT-001',
  description: 'Bag-ong parent para sa top-level mover.',
  price: 500,
  stock: 3,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Case',
};

export const REASSIGN_TOP_MOVER_CHILD: FullProduct & { parentId: string } = {
  id: 'test-reassign-top-mover-child',
  name: 'Reassign Top Mover Child',
  sku: 'RSN-TOP-CHD-001',
  description: 'Anak sa mover — kinahanglan magpabilin nested human sa move.',
  price: 34,
  stock: 0,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Piece',
  parentId: REASSIGN_TOP_MOVER.id,
};

/**
 * Dedicated, FULLY INDEPENDENT family para sa "Reassign factor auto-detect" test.
 * Wala ni gigamit/gi-mutate sa bisan unsang laing test — mao nga kini nga mover
 * magpabilin gyud nga top-level, ug ang no-match target magpabilin gyud nga
 * walay factor, bisan unsa pa ang order sa pag-execute sa spec file.
 *
 * REASSIGN_AUTO_MOVER — top-level product nga i-open/reassign (unit "Box").
 * REASSIGN_AUTO_MATCH — top-level target nga NAAY na conversion_factors row para
 *   sa mover's unit ("Box", factor 4) → auto-detect fires.
 * REASSIGN_AUTO_NOMATCH — top-level target nga WALAY factor para sa mover's unit
 *   → genuine blank case.
 */
export const REASSIGN_AUTO_MOVER: FullProduct = {
  id: 'test-reassign-auto-mover',
  name: 'Reassign Auto Mover',
  sku: 'RSN-AMV-001',
  description: 'Top-level mover nga dedicado sa auto-detect test.',
  price: 220,
  stock: 4,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Box',
};

export const REASSIGN_AUTO_MATCH: FullProduct = {
  id: 'test-reassign-auto-match',
  name: 'Reassign Auto Match Target',
  sku: 'RSN-AMT-001',
  description: 'Top-level nga naay Box factor — auto-detect dapat mo-fire.',
  price: 410,
  stock: 2,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Case',
};

export const REASSIGN_AUTO_NOMATCH: FullProduct = {
  id: 'test-reassign-auto-nomatch',
  name: 'Reassign Auto No Match Target',
  sku: 'RSN-ANM-001',
  description: 'Top-level nga walay Box factor — genuine blank case.',
  price: 415,
  stock: 2,
  brand: TEST_BRAND.name,
  category: TEST_CATEGORY.name,
  unitOfMeasure: 'Case',
};

/** Supplier + warehouse para sa purchase-order test. */
export const TEST_SUPPLIER = { id: 'sup-test', name: 'Test Supplier Co.' };
export const TEST_WAREHOUSE = { id: 'wh-test', name: 'Test Warehouse' };

/**
 * Product nga naka-link sa TEST_SUPPLIER — gikinahanglan kay ang PO ProductSelector
 * mo-filter sa products pinaagi sa gipili nga supplier (products nga walay maong
 * supplier dili motungha).
 */
export const PO_PRODUCT = {
  id: 'test-po-product-1',
  name: 'PO Line Item',
  sku: 'PO-ITEM-001',
  price: 25,
  cost: 18,
  stock: 0,
  supplierId: TEST_SUPPLIER.id,
};
