# verdix — User Guide

This guide walks through everyday tasks for both **Admin/Manager** users (backoffice dashboard) and **Cashier** users (POS terminal).

---

## Table of Contents

- [Admin Dashboard](#admin-dashboard)
  - [Logging In](#logging-in)
  - [Dashboard Overview](#dashboard-overview)
  - [Managing Products](#managing-products)
  - [Inventory Operations](#inventory-operations)
  - [Working with Purchase Orders](#working-with-purchase-orders)
  - [Sales & Reports](#sales--reports)
  - [Customer Management](#customer-management)
  - [Supplier Management](#supplier-management)
  - [Approvals Board](#approvals-board)
  - [User Management](#user-management)
- [POS Terminal](#pos-terminal)
  - [Starting a Shift](#starting-a-shift)
  - [Processing a Sale](#processing-a-sale)
  - [Applying Discounts](#applying-discounts)
  - [Holds & Recalls](#holds--recalls)
  - [Voids & Returns](#voids--returns)
  - [Ending a Shift (X/Z Reading)](#ending-a-shift-xz-reading)

---

## Admin Dashboard

### Logging In

1. Open the verdix admin app (browser at `http://localhost:3000` or Electron admin window).
2. Enter your **email** and **password**.
3. Click **Sign In**.

> Cashier accounts are automatically redirected to the POS terminal.

---

### Dashboard Overview

The dashboard shows at a glance:

- **Hourly Sales Chart** — bar chart of today's revenue by hour.
- **Monthly Sales Pie** — revenue distribution across categories.
- **Top Selling Products** — ranked by quantity sold this period.
- **Supplier Schedule** — upcoming deliveries from your suppliers.
- **Notification Bell** (top-right) — click to view low-stock alerts.

---

### Managing Products

#### Add a Product

1. Go to **Products** in the sidebar.
2. Click **Add Product** (top-right button).
3. Fill in the required fields: Name, SKU, Category, Price, Cost, UOM.
4. Optionally assign a Barcode, Warehouse, and Shelf Location.
5. Click **Save**.

#### Edit a Product

1. On the Products page, click the **⋯** menu on a product card or row.
2. Select **Edit**.
3. Modify the fields and click **Save**.

#### Set Up a Product Family (Bulk → Retail)

1. Create the **parent/bulk** product first (e.g., "Rice - 50kg Sack").
2. Create the **child/retail** product (e.g., "Rice - 1kg").
3. On the child product's edit form, set **Parent Product** to the bulk product.
4. Set the **Conversion Factor** (e.g., 50 = 50 retail from 1 sack).

#### Assign Price Levels

1. Open the product edit dialog.
2. Scroll to **Price Levels**.
3. Click **Add Price Level**, select a tier, and enter the price.
4. Save.

---

### Inventory Operations

#### Adjust Stock Manually

1. Go to **Inventory → Stock Levels**.
2. Find the product and click **Adjust Stock** (or use the bulk adjustment drawer).
3. Choose **Add** or **Remove** tab.
4. Enter the quantity and reason.
5. Click **Apply** (or **Submit for Approval** if confirmation is required).

#### Run a Physical Stock Count

1. Go to **Inventory → Stock Counts (Snapshots)**.
2. Click **New Stock Count**.
3. For each product, enter the **physical quantity** you counted.
4. Click **Submit Count**.
5. Review the **variance** (your count minus expected stock).
6. Click **Apply Variance** to update live stock (or submit for approval).

> **Counting while the store is open:** You do not need to close the POS to run a
> count. The system records the moment each line is entered and ignores any sale,
> delivery, or transfer that happens between starting the count and entering that
> quantity — those movements are already accounted for and are not treated as
> missing stock. Enter each quantity at the shelf as you count it, rather than
> writing quantities on paper and encoding them hours later: the system times the
> count from when you type it, so a long delay makes the figures less accurate.

#### Repack Stock (Break Pack)

1. Go to **Inventory → Repackaging**.
2. On the **Break Pack** tab, search for the bulk product.
3. Enter the quantity to break.
4. Review the resulting child quantities.
5. Click **Execute Break Pack** (or submit for approval).

#### Consolidate Stock (Pack → Bulk)

1. Go to **Inventory → Repackaging**.
2. Click the **Consolidation** tab.
3. Search for the small-unit product.
4. Enter the quantity to consolidate.
5. Click **Execute Consolidation**.

#### Move Stock Between Shelves

1. Go to **Inventory → Shelf Board**.
2. Each column is a shelf location.
3. Drag a product card from one shelf to another.
4. Confirm the transfer (or submit for approval).

---

### Working with Purchase Orders

#### Create a Purchase Order

1. Go to **Purchases → Purchase Orders**.
2. Click **Add Purchase Order**.
3. Select the **Supplier** — the due date is auto-calculated from payment terms.
4. Click **Add Item** to add products:
   - Enter Quantity, Cost, and optional Discount.
   - Click the **🪄 Wand** icon to get a suggested selling price.
5. Enter **Shipping Cost** (optional) — spread across items as landed cost.
6. Set the **Status**: Draft or Ordered.
7. Click **Save**.

#### Receive a Purchase Order

1. Open an Ordered/Partially Received PO.
2. Click **Receive**.
3. For each line item, enter the **quantity actually received**.
4. Click **Confirm Receipt** — stock is updated automatically.

#### Record a Bad Order

1. Open a received PO.
2. Click **Report Bad Order**.
3. Select the affected items, quantities, and reason.
4. Click **Submit**.

---

### Sales & Reports

#### View POS Sales

1. Go to **Sales → POS Sales Transaction**.
2. Filter by date range, cashier, terminal, or payment method.
3. Click a transaction row to see full details.
4. Use the **Reprint** button to reprint a receipt.

#### View Sales Orders (Backoffice)

1. Go to **Sales → Sales Order**.
2. Click **New Order** to create a backoffice order.
3. Assign a customer, add items, set delivery date.
4. Change status to **To Deliver** when ready to ship.

#### Export Reports

Most report pages have an **Export CSV** or **Download PDF** button at the top-right.

#### Z-Reading (End of Day)

1. Go to **Sales → POS Z-Reading**.
2. Select the terminal and date.
3. Click **Generate Z-Reading** to view the official report.
4. Print the report using the **Print** button.

---

### Customer Management

#### Add a Customer

1. Go to **Customers → Customer List**.
2. Click **Add Customer**.
3. Fill in Name, Contact, Address, and optional credit/loyalty settings.
4. Click **Save**.

#### Record a Customer Payment

1. Go to **Customers → Customer Payment**.
2. Select the customer.
3. Select the outstanding invoices to apply the payment to.
4. Enter the payment amount and method.
5. Click **Record Payment**.

#### View Customer Loyalty Points

1. Go to **Customers → Customer Loyalty Points**.
2. Find the customer.
3. View their point balance and history.
4. Use **Adjust Points** to manually add or deduct points.

---

### Supplier Management

#### Add a Supplier

1. Go to **Suppliers → Supplier List**.
2. Click **Add Supplier**.
3. Fill in contact details, payment terms, and default markup %.
4. Click **Save**.

#### Record a Supplier Payment

1. Go to **Suppliers → Payment Suppliers**.
2. Select the supplier.
3. Enter the payment amount and reference.
4. Click **Record Payment**.

---

### Approvals Board

The Approvals Board appears as a **slide-over drawer** accessed from the sidebar (Management section).

#### Reviewing an Approval

1. Click **Approvals Board** in the sidebar.
2. Find items in the **Pending** column.
3. Click a card to review the details.
4. Click **Approve** or **Reject**.
5. If a 2nd-level approval is configured, approved items move to **Pending L2**.

#### Configuring Approval Workflows

1. Click **Workflow Settings** in the sidebar.
2. Enable approvals for specific transaction types.
3. Assign approvers at each level.

---

### User Management

#### Add a User

1. Go to **User Management**.
2. Click **Add User**.
3. Enter the username, full name, email, and password.
4. Assign a **User Type** (Admin, Manager, Cashier, or a custom type).
5. Click **Create**.

#### Create a Custom User Type

1. On the User Management page, click **Manage User Types**.
2. Click **Add User Type**.
3. Name the type and toggle individual permissions on/off.
4. Click **Save**.

---

## POS Terminal

### Starting a Shift

1. Open the POS window (or press `npm run electron-only`).
2. Log in with your cashier credentials.
3. The **Start Shift** dialog appears — enter your **starting cash** in the drawer.
4. Click **Start Shift**.

---

### Processing a Sale

1. **Add items:**
   - Scan the product barcode, or
   - Type the product name/SKU in the search bar and press Enter.
2. **Adjust quantity:** Click the item in the cart and use `+` / `-`, or type the quantity directly.
3. **Attach a customer (optional):** Click the **Customer** button and search.
4. Click **Tender** (or press `F2`).
5. In the Tender Dialog, enter the amount received (or select the exact amount).
6. Click **Complete Sale** — the receipt prints automatically.

---

### Applying Discounts

#### Line-Level Discount

1. Click on an item in the cart.
2. Press `F3` (or click the discount icon).
3. Enter the discount % or fixed amount.
4. Click **Apply**.

#### SC/PWD Discount

1. Attach a customer to the sale.
2. In the Tender dialog, toggle **Senior Citizen / PWD Discount**.
3. The 20% statutory discount is applied automatically.

#### Price Override

1. Click on an item in the cart.
2. Press `F7` (Edit Price).
3. Enter the new price (admin PIN may be required).
4. Click **Apply**.

---

### Holds & Recalls

#### Hold a Transaction

1. Press `F4` or click **Hold**.
2. The current cart is saved and a new blank cart opens.

#### Recall a Held Transaction

1. Press `F5` or click **Held Transactions**.
2. Select the held transaction to restore it to the active cart.

---

### Voids & Returns

#### Void the Current Transaction (Before Tender)

1. Press `ESC` or click **Cancel Sale**.
2. Confirm the cancellation.

#### Void a Completed Transaction (Post-Void)

1. Press `F9` or click **Void Transaction**.
2. Select the transaction to void (or scan the receipt number).
3. Enter admin credentials if required.
4. Confirm the void.

#### Process a Return

1. Click **Return** in the POS menu.
2. Search for the original sale (by receipt number or date).
3. Select the items and quantities being returned.
4. Choose refund method.
5. Click **Process Return** — a merchandise credit slip prints automatically.

---

### Ending a Shift (X/Z Reading)

#### X-Reading (Mid-Shift Summary)

1. Click the **☰ Menu** → **X-Reading**.
2. Review the current shift totals.
3. Print if needed. Shift remains open.

#### Z-Reading (End of Day)

1. Click the **☰ Menu** → **End Shift / Z-Reading**.
2. The **Cash Count** screen appears — enter the denomination breakdown.
3. Review the Z-Reading summary (gross sales, voids, returns, payment breakdown).
4. Click **Close Shift** — the Z-counter increments and the shift is locked.
5. Print the Z-Reading receipt.

---

## Keyboard Shortcuts (POS)

| Key | Action |
|-----|--------|
| `F1` | Edit item name/description |
| `F2` | Open Tender dialog |
| `F3` | Apply line discount |
| `F4` | Hold transaction |
| `F5` | Recall held transactions |
| `F6` | Price inquiry |
| `F7` | Edit item price |
| `F8` | Recent sales (current shift) |
| `F9` | Void transaction |
| `ESC` | Cancel / clear cart |
| `Enter` / `Barcode scan` | Add item to cart |
