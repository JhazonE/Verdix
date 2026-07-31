# verdix API Endpoints

All endpoints are prefixed with `/api`. The base URL in development is `http://localhost:3000`.  
All responses return `{ success: boolean, data?: any, error?: string }`.

---

## Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Authenticate a user (returns user object + permissions) |
| POST | `/api/auth/signup` | Register a new user |
| GET/POST | `/api/accounts` | Account management |

---

## Approvals

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/approvals/queue` | List or add to the approval queue |
| POST | `/api/approvals/process` | Approve or reject a queued item |
| GET/POST/PUT | `/api/approvals/workflows` | Configure approval workflow rules |

---

## Bad Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/bad-orders` | List all bad orders or create a new one |
| GET/PATCH/DELETE | `/api/bad-orders/[id]` | Get, update, or delete a specific bad order |
| GET | `/api/bad-orders/stats` | Bad order statistics (count, value by status) |

---

## Customers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/customers` | List all customers or create a new one |
| GET/PATCH/DELETE | `/api/customers/[id]` | Get, update, or delete a customer |
| GET | `/api/customers/[id]/check-transactions` | Check if customer has active transactions |
| GET | `/api/customers/balances` | All customers with outstanding balances |
| GET | `/api/customers/invoices/[id]` | Get specific customer invoice |
| POST | `/api/customers/invoices/[id]/payment` | Record a payment against an invoice |
| GET | `/api/customers/invoices/outstanding` | All outstanding customer invoices |
| GET/POST | `/api/customers/payments` | Customer payment history or record payment |

---

## Customer Loyalty

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/customer-loyalty` | List loyalty records or update |
| GET | `/api/customer-loyalty/[id]` | Get a customer's loyalty record |
| POST | `/api/customer-loyalty/adjust-points` | Manually adjust points |
| GET | `/api/customer-loyalty/lookup` | Lookup by card/phone number |
| GET | `/api/customer-loyalty/point-history` | Points earning/redemption history |
| GET/POST | `/api/customer-payments` | Record customer payments |
| GET/PUT | `/api/loyalty-settings` | Get or update loyalty program configuration |
| GET/PUT | `/api/loyalty-settings/[id]` | Specific loyalty setting |

---

## Data Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/data` | General data endpoint |
| GET | `/api/data-management/export/customers` | Export customers as CSV |
| GET | `/api/data-management/export/products` | Export products as CSV |
| POST | `/api/data-management/import/customers` | Import customers from CSV |
| POST | `/api/data-management/import/products` | Import products from CSV |
| POST | `/api/data-management/reset` | Reset all data (requires confirmation) |
| POST | `/api/migrate` | Run database migrations |
| POST | `/api/migrate/batch-costing` | Migration: batch costing schema |
| POST | `/api/migrate/fix-batch-ids` | Migration: normalize batch IDs to 6 digits |

---

## External API / Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/external-api/logs` | List outbound webhook delivery logs |
| POST | `/api/external-api/logs/[id]/retry` | Retry a failed webhook delivery |

---

## Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/inventory/adjust/bulk` | Bulk stock adjustment for multiple products |
| GET/POST | `/api/inventory/stock-counts` | List stock counts or create a new count |
| GET | `/api/inventory/stock-counts/[id]` | Get a specific stock count |
| POST | `/api/inventory/stock-counts/[id]/complete` | Apply stock count variances |
| GET/POST | `/api/inventory/stock-counts/[id]/items` | Get or update count line items |
| POST | `/api/inventory/transfer` | Transfer stock between shelf locations |
| POST | `/api/inventory/transfer/bulk` | Bulk shelf transfer |

---

## Payment Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/payment-methods` | List or create payment methods |
| GET/PUT/DELETE | `/api/payment-methods/[id]` | Get, update, or delete a payment method |
| GET/POST | `/api/payment-term-types` | Payment term type management |
| GET/POST | `/api/payment-terms` | Payment terms (e.g., Net 30, COD) |

---

## Point of Sale (POS)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pos/checkout` | Process a POS sale (deducts stock, records transaction) |
| GET | `/api/pos/recent-sales` | Get recent sales for current shift |
| POST | `/api/pos/void-transaction` | Void a completed transaction |
| POST | `/api/pos/cash-transfer` | Record a cash pickup or deposit |
| GET/POST | `/api/pos/shifts` | List shifts or start a new shift |
| POST | `/api/pos/payment-validation` | Validate payment amounts before checkout |
| GET/POST | `/api/pos-terminals` | List or register POS terminals |
| GET/POST | `/api/pos-transactions` | POS transaction records |
| GET/POST | `/api/pos-settings` | Get or update POS configuration |
| POST | `/api/pos-settings/upload-logo` | Upload business logo for receipts |

---

## Price Levels

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/price-levels` | List or create price level tiers |

---

## Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/products` | List or create products |
| GET/PATCH/DELETE | `/api/products/[id]` | Get, update, or delete a product |
| GET/POST | `/api/products/attributes` | Product attribute management (categories, brands, etc.) |

---

## Purchase Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/purchase-orders` | List or create purchase orders |
| GET/PATCH/DELETE | `/api/purchase-orders/[id]` | Get, update, or delete a PO |
| GET | `/api/purchase-orders/export` | Export purchase orders as CSV |

---

## Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/adjustments` | Stock adjustment report |
| GET | `/api/reports/inventory` | Current inventory value report |
| GET | `/api/reports/movements` | Stock movement report |
| GET | `/api/reports/purchases/by-product` | Purchase report by product |
| GET | `/api/reports/purchases/by-supplier` | Purchase report by supplier |
| GET | `/api/reports/soa` | Statement of Account (customer/supplier) |
| GET | `/api/reports/stats` | High-level dashboard statistics |
| GET | `/api/reports/velocity` | Sales velocity (units/day) report |

---

## Sales

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/sales` | List sales transactions |
| GET | `/api/sales/batch-analysis` | Profit analysis per inventory batch |
| GET | `/api/sales/by-date` | Sales aggregated by date |
| GET | `/api/sales/by-product` | Sales aggregated by product |
| GET | `/api/sales/ejournal` | Electronic journal for BIR |
| GET | `/api/sales/hourly` | Hourly sales breakdown |
| POST | `/api/sales/invoices/[id]/void` | Void a sales invoice |
| GET | `/api/sales/monthly-category` | Monthly sales by category |
| GET/POST | `/api/sales/orders` | Backoffice sales orders |
| GET/PATCH | `/api/sales/orders/[id]` | Specific sales order |
| GET/POST | `/api/sales/returns` | Merchandise credit / returns |
| GET | `/api/sales/top-products` | Top selling products |
| GET | `/api/sales/transactions` | Detailed POS transaction log |
| GET | `/api/sales/voids-report` | Void transaction report |
| GET | `/api/sales/x-reading` | X-Reading (shift summary) generation |
| GET | `/api/sales/z-reading` | Z-Reading (end-of-day) generation |

---

## Sales Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/sales-areas` | Sales area management |
| GET/POST | `/api/sales-groups` | Sales group management |
| GET/POST | `/api/sales-persons` | Sales person list |
| GET/PATCH/DELETE | `/api/sales-persons/[id]` | Specific sales person |

---

## Settings & Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/settings/api-config` | API configuration |
| GET/POST | `/api/settings/api-connection` | Test external API connection |
| GET | `/api/settings/backup/download/[filename]` | Download a backup file |
| GET | `/api/settings/backup/files` | List available backup files |
| POST | `/api/settings/backup/manual` | Trigger a manual backup |
| POST | `/api/settings/backup/restore` | Restore from a backup file |
| GET/POST | `/api/settings/backup/schedule` | Get or update backup schedule |
| GET/POST | `/api/settings/database` | Database connection settings |
| GET/POST | `/api/settings/external-api` | Outbound webhook configuration |
| GET/POST | `/api/settings/tax-rates` | Tax rate list |
| GET/PUT/DELETE | `/api/settings/tax-rates/[id]` | Specific tax rate |

---

## Shelf Locations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/shelf-locations` | List or create shelf locations |
| GET/PATCH/DELETE | `/api/shelf-locations/[id]` | Specific shelf location |

---

## Sta. Lucia Tenant System Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/integrations/sta-lucia/send` | Submit one Z-reading to the mall's Sale Consolidator API. Body `{ apiId?, zReadingId? }`; omitting `zReadingId` sends the latest. Idempotent — an atomic claim row in `sta_lucia_submissions` stops concurrent or retried sends from double-submitting. |
| POST | `/api/integrations/sta-lucia/test` | Dry run: login → sample sales → get-transactions → logout. Returns the exact payload sent plus each raw response. |
| POST/GET | `/api/dev/mock-sta-lucia/*` | Local mock of the external API for development and E2E tests; 404s when `NODE_ENV=production`. |

Configured at Settings → External API Integrations with Provider set to "Sta. Lucia Tenant System". The credentials are the mall-issued tenant account (an email), not a Verdix login (a username).

---

## Stock

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/stock-adjustments` | List or create stock adjustments |
| GET | `/api/stock-adjustments/[id]` | Specific stock adjustment |
| GET | `/api/stock-movements` | Stock movement audit log |

---

## Suppliers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/suppliers` | List or create suppliers |
| GET/PATCH/DELETE | `/api/suppliers/[id]` | Get, update, or delete a supplier |
| GET | `/api/suppliers/[id]/balance` | Supplier outstanding balance |
| GET | `/api/suppliers/export` | Export supplier list as CSV |
| GET/POST | `/api/temp-suppliers` | Temporary supplier import staging |

---

## Transactions & References

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/transaction-references` | Transaction reference sequences |
| GET | `/api/transactions/all-references` | All configured reference sequences |
| GET | `/api/transactions/last-references` | Last used reference numbers |

---

## Users & Permissions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/users` | List or create users |
| GET/PATCH | `/api/users/[uid]` | Get or update a user |
| GET/POST | `/api/user-types` | List or create user types |
| GET/PUT/DELETE | `/api/user-types/[id]` | Specific user type |

---

## Warehouses

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/warehouses` | List or create warehouses |
| GET/PATCH/DELETE | `/api/warehouses/[id]` | Specific warehouse |

---

## Utility

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/forward` | Forward a request to an external API endpoint |
| POST | `/api/send-products` | Send product data to an external system |
