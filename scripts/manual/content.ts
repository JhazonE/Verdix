/**
 * Verdix POS User Manual — content data.
 *
 * All manual prose lives here as structured data. A later task renders this
 * into a Word document with screenshots (see `screens.ts` for the figure
 * slugs). This file has no Word or Playwright dependency — it is pure
 * content that can be reviewed for accuracy on its own.
 *
 * Every quoted button, field, or menu label below was verified against the
 * actual page component before being written down. See task-4-report.md
 * for the full list of files checked.
 */

export type Block =
  | { kind: 'para'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'figure'; slug: string }
  | { kind: 'note'; variant: 'tip' | 'warning'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

export type Section = { heading: string; blocks: Block[] };

export type Chapter = { number: number; title: string; intro: string; sections: Section[] };

export const MANUAL_TITLE = 'Verdix POS — User Manual';
export const MANUAL_SUBTITLE = 'A step-by-step guide for cashiers and back-office staff';

export const CHAPTERS: Chapter[] = [
  // ────────────────────────────────────────────────────────────────────
  // Chapter 1 — Getting Started
  // ────────────────────────────────────────────────────────────────────
  {
    number: 1,
    title: 'Getting Started',
    intro:
      'This chapter covers the very first things you need to do before you can use Verdix POS: activating the software on a new computer, and logging in to the back office. If your store already has Verdix running and you only work the cashier counter, you can skip ahead to Chapter 2 — Cashier / POS.',
    sections: [
      {
        heading: 'Activating Verdix on a new computer',
        blocks: [
          {
            kind: 'para',
            text: 'The first time Verdix POS is installed on a computer, it will not let you use the system until it has been activated with a license key. This is a one-time step per computer — once activation succeeds, that computer stays activated. If you see a card titled "Verdix POS — License Activation" instead of the app you expect, follow the steps below.',
          },
          {
            kind: 'para',
            text: 'The license is tied to that specific computer through its Machine ID, a unique code generated from the computer\'s own hardware. A license activated on one computer will not work on another — if you move Verdix to a new or replacement computer, it needs to be activated again with a new key for that machine.',
          },
          {
            kind: 'steps',
            items: [
              'Look at the text under the card title. It tells you why activation is needed (for example "Activation required" or "License expired").',
              'If this computer has an internet connection, stay on the "Online" tab. Type the product key you were given (it looks like VRDX-XXXX-XXXX-XXXX) into the "Product Key" field.',
              'Click the "Activate Online" button.',
            ],
          },
          { kind: 'figure', slug: 'activate-online' },
          {
            kind: 'steps',
            items: [
              'If this computer does not have internet access, click the "Offline" tab instead.',
              'Under "Your Machine ID" you will see this computer\'s unique code. Click the small copy button next to it and send the copied code to your supplier.',
              'Your supplier will send back a license key. Paste the full key they gave you into the "License Key" box.',
              'Click the "Activate License" button.',
            ],
          },
          { kind: 'figure', slug: 'activate-offline' },
          {
            kind: 'note',
            variant: 'tip',
            text: 'If activation fails because the license was issued for a different computer, copy this computer\'s "Your Machine ID" (on the "Offline" tab) and send it to your supplier so they can issue a new key for this machine.',
          },
        ],
      },
      {
        heading: 'Logging in to the back office',
        blocks: [
          {
            kind: 'para',
            text: 'The back office is where managers and admin staff manage products, inventory, purchases, suppliers, customers, reports, and settings. Cashiers who only work the counter do not need this login — see Chapter 2 for the separate cashier login screen at the POS terminal.',
          },
          {
            kind: 'steps',
            items: [
              'Type your username into the "Username" field.',
              'Type your password into the "Password" field. Click the eye icon inside the field if you want to check what you typed before submitting.',
              'Click the "Sign In" button.',
            ],
          },
          { kind: 'figure', slug: 'login' },
          {
            kind: 'para',
            text: 'If your account is set up as a Cashier or Employee user type, Verdix will send you straight to the POS screen instead of the back office dashboard — this is expected. Back-office pages are for Admin and Manager accounts.',
          },
        ],
      },
      {
        heading: 'The dashboard',
        blocks: [
          {
            kind: 'para',
            text: 'After signing in as an admin or manager, you land on the Dashboard. It shows a quick snapshot of the business: sales charts, top-selling products, sales by category, and a supplier delivery schedule. Use the sidebar on the left to move to any other part of the system — Products, Inventory, Purchases, Suppliers, Customers, Approvals, Reports, User Management, and Settings all live there.',
          },
          { kind: 'figure', slug: 'dashboard' },
          {
            kind: 'para',
            text: 'The dashboard is read-only — it is meant for a quick daily check, not for making changes. To act on anything you see (restock a product, approve a request, and so on) go to the matching page from the sidebar.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 2 — Cashier / POS
  // ────────────────────────────────────────────────────────────────────
  {
    number: 2,
    title: 'Cashier / POS',
    intro:
      'This chapter is for cashiers working the checkout counter. The POS screen is a separate, full-screen part of Verdix designed to be fast to use with a barcode scanner and keyboard. It has its own login, separate from the back-office login in Chapter 1, and it manages its own shift and cash drawer.',
    sections: [
      {
        heading: 'Cashier login',
        blocks: [
          {
            kind: 'para',
            text: 'The POS terminal shows its own "Cashier Login" card, separate from the back-office sign-in page. Every cashier logs in here with their own username and password before they can ring up a sale.',
          },
          {
            kind: 'steps',
            items: [
              'Type your username into the "Username" field.',
              'Type your password into the "Password" field.',
              'Click the "Login to POS" button.',
            ],
          },
          { kind: 'figure', slug: 'pos-login' },
          {
            kind: 'note',
            variant: 'tip',
            text: 'If the terminal is not connecting correctly, click the small gear icon in the top-right corner of the login card to open Connection Settings before asking your manager for help.',
          },
        ],
      },
      {
        heading: 'Starting your shift',
        blocks: [
          {
            kind: 'para',
            text: 'After logging in, every cashier must start a shift before the register will let them ring up items. Starting a shift records how much cash is in the drawer at the beginning of the day, so it can be checked against sales later.',
          },
          {
            kind: 'steps',
            items: [
              'When the "Start New Shift" dialog appears, count the cash physically in your drawer.',
              'Enter the quantity of each bill and coin denomination in the "Bills" and "Coins" columns.',
              'Check that the "Total Starting Cash" amount shown matches what you counted.',
              'Click the "Start Shift" button to begin.',
            ],
          },
          { kind: 'figure', slug: 'pos-start-shift' },
          {
            kind: 'para',
            text: 'If you close the Start New Shift dialog without starting a shift, you will be logged out of the POS. If another cashier already has a shift open on this terminal, you will instead see a takeover screen asking whether to continue that shift or start a new one — check with your manager before choosing.',
          },
        ],
      },
      {
        heading: 'Ringing up a sale',
        blocks: [
          {
            kind: 'para',
            text: 'Once your shift is active, the main POS screen is ready to take sales. The large input box at the top is where you scan or type every item.',
          },
          {
            kind: 'steps',
            items: [
              'Click into the "Scan Barcode or Enter Product SKU (Enter)" box (it is usually already focused and ready).',
              'Scan the item with the barcode scanner, or type its SKU, then press Enter.',
              'The item appears as a new row in the cart with its description, unit, price, quantity, and line total.',
              'Repeat for every item the customer is buying. If the cart is empty, it will show "Cart is empty" with a shopping cart icon until you scan the first item.',
              'To change a line, click the item name to edit it, click the quantity to change how many, or click the price to override it (each has an on-screen or F-key shortcut shown at the top of the screen, such as F6 for quantity and F7 for price).',
            ],
          },
          { kind: 'figure', slug: 'pos-empty' },
          { kind: 'figure', slug: 'pos-cart' },
          {
            kind: 'para',
            text: 'The row of buttons across the top of the screen (Edit Item, Line Void, Discount, Suspend, Suspended, Quantity, Edit Price, and Shutdown/Endorse-Out) act on whichever cart line is currently selected. The row of buttons across the bottom (Cash count, Cash transfer, Customer, Loyalty, Recent Sales, Post Void, Merch Credit, OVERALL, Z-READING, Price Inquiry) are shift- and store-level actions rather than per-item actions.',
          },
        ],
      },
      {
        heading: 'Taking payment',
        blocks: [
          {
            kind: 'para',
            text: 'When every item is in the cart, press Enter on an empty barcode box to open the payment screen (called "Tender Payment").',
          },
          {
            kind: 'steps',
            items: [
              'Check the "Total Due" amount shown at the top of the Tender Payment screen.',
              'Choose the "Payment Method" from the dropdown (for example Cash, Card, or Charge to Account).',
              'For a cash sale, type the amount the customer handed you into "Amount Tendered". Quick-amount buttons are provided for common bill values.',
              'If the customer is a member with loyalty points, you can redeem points in the "Redeem Points" box before confirming.',
              'Click the "Confirm Payment" button to complete the sale.',
              'If change is due, the amount is shown on a "Change Due" screen. Click "Next" to continue.',
              'A prompt then asks whether to print the receipt. Click "Yes, Print" to print it, or "No, Skip" to skip printing and open the cash drawer without a receipt.',
              'After the sale finishes, the cart clears and shows "Cart is empty" again, ready for the next customer.',
            ],
          },
          {
            kind: 'para',
            text: 'A "Charge to Account" payment requires a customer to be selected first — the system will show a "Select Customer" prompt if you try to charge a walk-in sale. Use the "Customer" button at the bottom of the main POS screen to attach a customer to the sale before tendering.',
          },
        ],
      },
      {
        heading: 'Ending your shift',
        blocks: [
          {
            kind: 'para',
            text: 'At the end of your shift, use the "Cash count" button at the bottom of the POS screen to open "End Current Shift". This counts the cash physically in the drawer and compares it to what the system expects, based on your starting cash and the day\'s cash sales.',
          },
          {
            kind: 'steps',
            items: [
              'Count every bill and coin in the drawer and enter the quantities under "Cash Drawer Count".',
              'Compare the "Actual Counted" total on the right against the "Expected Transfer" amount.',
              'If the two match, the screen shows "Perfect Balance". If they do not, it shows "Cash Overage" or "Cash Shortage" with the difference.',
              'Click "Confirm and End Shift" to close out and hand over the drawer.',
            ],
          },
          {
            kind: 'para',
            text: 'If you collected any membership fees in cash during your shift, they appear on their own line, "Membership Fees (cash)", above the "Expected Transfer" total. That money is part of what the drawer should hold, so it is already included in the expected amount you count against.',
          },
          {
            kind: 'note',
            variant: 'tip',
            text: 'Re-count carefully if you see a shortage larger than a few pesos before confirming — once the shift is ended it cannot be reopened.',
          },
        ],
      },
      {
        heading: 'X-Reading and Z-Reading',
        blocks: [
          {
            kind: 'para',
            text: 'X-Reading and Z-Reading are official cash register reports required for Philippine tax (BIR) compliance. Both require an admin username and password to open, entered in the authentication dialog that appears first.',
          },
          {
            kind: 'steps',
            items: [
              'From the POS screen, use the "OVERALL" button for the overall reading, or open the X-Reading / Z-Reading page directly.',
              'Enter admin credentials in the authentication dialog when prompted.',
              'Review the report on screen, then print it using the printer if a hard copy is needed for records.',
            ],
          },
          { kind: 'figure', slug: 'pos-x-reading' },
          { kind: 'figure', slug: 'pos-z-reading' },
          {
            kind: 'para',
            text: 'When membership fees were collected in cash during the shift, the printed reading slip carries a "Membership (cash)" line with the number of activations and renewals beneath it. Note that this line is on the printed slip — the on-screen report does not show it, so print the reading if you need membership figures for your records.',
          },
          {
            kind: 'note',
            variant: 'warning',
            text: 'A Z-Reading closes out the day\'s sales totals for BIR reporting and cannot be run again for that day once completed. An X-Reading is a mid-shift snapshot and does NOT close or reset anything — run as many X-Readings as you like during the day, but only run the Z-Reading once, at the true end of the business day.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 3 — Products
  // ────────────────────────────────────────────────────────────────────
  {
    number: 3,
    title: 'Products',
    intro:
      'The Products page is where every item your store sells is set up: its name, SKU, barcode, price, cost, and category. This is back-office work, done by an admin or manager, not by cashiers at the counter.',
    sections: [
      {
        heading: 'Browsing and searching products',
        blocks: [
          {
            kind: 'para',
            text: 'The Products page lists every product in a table, with stock status shown as a colored badge ("In Stock", "Low Stock", "Out of Stock", or "Available" for service items that carry no stock).',
          },
          {
            kind: 'steps',
            items: [
              'Type into the "Search products..." box to find a product by name.',
              'Click "Filter Products" to narrow the list by Brand, Category, Supplier, Warehouse, Shelf Location, Status, or Department, then click "Apply Filters".',
              'Products that belong to a family (for example a 1kg bag with smaller child units) show an expand arrow on the left — click it to reveal the child units underneath, indented and labeled "Child Unit".',
            ],
          },
          { kind: 'figure', slug: 'products-list' },
        ],
      },
      {
        heading: 'Adding a new product',
        blocks: [
          {
            kind: 'para',
            text: 'New products are added from the Products page using the add-product form, which opens as a dialog with several tabs for basic info, pricing, inventory settings, unit conversions, and loyalty rules.',
          },
          {
            kind: 'steps',
            items: [
              'On the Products page, click the "Add Product" button.',
              'Fill in the basic details: name, SKU, barcode, brand, category, and department.',
              'Switch to the pricing tab to set the cost and retail price.',
              'Switch to the inventory tab to set the reorder point and starting stock, if any.',
              'If this product has related pack sizes (for example a case and individual pieces), use the conversion tab to define the conversion factor between them.',
              'Save the product when all required fields are filled in.',
            ],
          },
        ],
      },
      {
        heading: 'Editing a product and managing lookups',
        blocks: [
          {
            kind: 'para',
            text: 'Each product row has an actions menu (the vertical-dots icon on the right) with options: "View Details", "Edit Product", "Print Barcode", "Restock" (shown only when stock is low or out), "Add Child Unit" (shown only on products with conversion factors set up), and "Delete Product".',
          },
          {
            kind: 'steps',
            items: [
              'Click the actions menu on the product row you want to change.',
              'Choose "Edit Product" to update its details, or "Print Barcode" to print a barcode label for the shelf.',
              'To delete a product, choose "Delete Product" and confirm — this cannot be undone.',
            ],
          },
          {
            kind: 'para',
            text: 'The "Manage" button at the top of the Products page opens a menu for the shared lookup lists used across all products: Manage Brands, Manage Categories, Manage Price Levels, Manage Suppliers, Manage Shelf Locations, Manage Departments, Manage Warehouse, and Manage Unit of Measure. Set these up first if they do not already contain the values you need.',
          },
        ],
      },
      {
        heading: 'Product families and child units',
        blocks: [
          {
            kind: 'para',
            text: 'Verdix supports product families: a parent product (for example a 1kg bag) can be broken down into smaller child units (for example 250g sachets) using a conversion factor. Any stock change to the parent or a child automatically syncs the stock of every other member of the family, so the whole family always reflects the same underlying physical stock.',
          },
          {
            kind: 'note',
            variant: 'tip',
            text: 'Only products with conversion factors configured show the "Add Child Unit" option. Set up the conversion tab when adding or editing the parent product before trying to add a child unit.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 4 — Inventory
  // ────────────────────────────────────────────────────────────────────
  {
    number: 4,
    title: 'Inventory',
    intro:
      'The Inventory section is where you monitor and adjust stock levels, run physical stock counts, repackage bulk items into smaller packs, and review the history of every stock change. It works closely with Products (Chapter 3), which defines what each item is, while Inventory tracks how much of it you actually have.',
    sections: [
      {
        heading: 'Viewing stock levels',
        blocks: [
          {
            kind: 'para',
            text: 'The main Inventory page shows every product with its current stock level, either as cards (grid view) or as a table (list view), using the toggle at the top right.',
          },
          {
            kind: 'steps',
            items: [
              'Use the "Search products by name or SKU..." box to find a specific item.',
              'Use "Sort by" to order the list by Name, Stock Level, or SKU.',
              'Use "Product type" to filter to Standard or Service items only.',
              'Switch between grid and list view using the two buttons at the top right.',
            ],
          },
          { kind: 'figure', slug: 'inventory-levels' },
          {
            kind: 'para',
            text: 'The toolbar above the list also links to related tools: "Transfer Board" (move stock between warehouses), "Shelf Board" (organize shelf locations), "Bulk Adjustment" (adjust many products at once), "Stock Batches" (view FIFO cost batches), and "History" (the full adjustment log, covered later in this chapter).',
          },
          {
            kind: 'note',
            variant: 'tip',
            text: 'Because product families sync stock automatically, adjusting the stock of a child unit (like a sachet) will also update the parent (like the bulk bag) it was broken from, and vice versa.',
          },
        ],
      },
      {
        heading: 'Running a stock count',
        blocks: [
          {
            kind: 'para',
            text: 'A stock count (sometimes called a physical inventory) is a snapshot used to reconcile what the system thinks you have against what is physically on the shelf.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Inventory → Stock Counts.',
              'Start a new count for the products or warehouse you want to check.',
              'Walk the floor and enter the physical quantity counted for each product.',
              'Submit the count. Any variance between the counted quantity and the system quantity is recorded and, depending on your store\'s settings, may need approval before the stock is corrected (see Chapter 7 — Approvals).',
            ],
          },
          { kind: 'figure', slug: 'inventory-stock-counts' },
        ],
      },
      {
        heading: 'Repackaging (Break Pack and Pack → Bulk)',
        blocks: [
          {
            kind: 'para',
            text: 'The Repackaging page converts bulk inventory into individual packs, or merges packs back into bulk — the reverse operation. It has three tabs: "Break Pack" (bulk to packs), "Pack → Bulk" (consolidation, the reverse of Break Pack), and "History" (a log of every repackaging session, including its direction, quantities used and produced, and status).',
          },
          {
            kind: 'steps',
            items: [
              'To break down bulk stock into packs, open the "Break Pack" tab, choose the source product and quantity to use, and submit.',
              'To merge pack units back into bulk stock, open the "Pack → Bulk" tab instead and submit the consolidation.',
              'Check the "History" tab afterward to confirm the session completed — completed sessions show a green "completed" badge.',
            ],
          },
          { kind: 'figure', slug: 'inventory-repackaging' },
        ],
      },
      {
        heading: 'Stock movement and adjustment history',
        blocks: [
          {
            kind: 'para',
            text: 'Every stock change in Verdix — a sale, a purchase received, a transfer, an adjustment, or a repackaging — writes a record so it can be traced later. The "Stock Movement" page lists these movements per product with the date, type (sale, purchase, transfer, and so on), and quantity change. The "Adjustment History" page focuses specifically on manual stock adjustments, showing the reason for each one and whether it is still pending approval.',
          },
          { kind: 'figure', slug: 'inventory-movement' },
          { kind: 'figure', slug: 'inventory-history' },
          {
            kind: 'para',
            text: 'Use these history pages whenever a stock number looks wrong and you need to trace back what happened and who made the change.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 5 — Purchasing & Suppliers
  // ────────────────────────────────────────────────────────────────────
  {
    number: 5,
    title: 'Purchasing & Suppliers',
    intro:
      'This chapter covers ordering stock from suppliers, receiving deliveries, recording damaged or defective goods, and tracking what your store owes each supplier and when payments are made.',
    sections: [
      {
        heading: 'Creating a purchase order',
        blocks: [
          {
            kind: 'para',
            text: 'A purchase order (PO) records what you are ordering from a supplier, at what cost, before the goods arrive.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Purchases.',
              'Click "Add New Purchase Order".',
              'Choose the supplier and add each product with the quantity and cost being ordered.',
              'Save the order — it appears in the purchase orders table with a status of pending delivery.',
            ],
          },
          { kind: 'figure', slug: 'purchases' },
          {
            kind: 'para',
            text: 'Once goods arrive, open the order and use the receive action to record the delivery. This updates stock levels through the FIFO batch system — new stock is added as a new cost batch, and future sales will still deplete the oldest batch first before touching this new stock.',
          },
        ],
      },
      {
        heading: 'How receiving a delivery changes cost and retail price',
        blocks: [
          {
            kind: 'para',
            text: 'When you receive a delivery, Verdix does not simply overwrite the product\'s cost and retail price with whatever is on the new purchase order. It follows one simple rule, which applies to the cost and the retail price separately: the higher value always wins.',
          },
          {
            kind: 'para',
            text: 'In other words, a delivery can raise a product\'s cost and retail price, but it can never lower them. If your supplier charges more this time, the product takes the new, higher cost and retail price. If your supplier charges less this time, the product keeps the older, higher figures it already had.',
          },
          {
            kind: 'table',
            headers: ['What happened on the new delivery', 'What the product ends up with'],
            rows: [
              ['New cost is HIGHER than the current cost', 'The product takes the new, higher cost.'],
              ['New cost is LOWER than the current cost', 'The product keeps its existing, higher cost. The new lower cost is ignored.'],
              ['New retail price is HIGHER than the current retail price', 'The product takes the new, higher retail price.'],
              ['New retail price is LOWER than the current retail price', 'The product keeps its existing, higher retail price.'],
              ['The retail price is left blank on the purchase order', 'The product keeps its existing retail price — a blank price never lowers it.'],
            ],
          },
          {
            kind: 'para',
            text: 'Here is a worked example. A product currently has a cost of 100 pesos and a retail price of 130 pesos. A delivery arrives where the same product cost 120 pesos, so the cost rises to 120 and, if the purchase order also carries a higher retail price, the retail price rises with it. On the next delivery the supplier charges only 90 pesos. Because 90 is lower than 120, the product keeps its cost of 120 — the cheaper price does not pull it back down.',
          },
          {
            kind: 'para',
            text: 'The cost being compared is the landed cost, not just the price on the supplier\'s invoice. Landed cost is the item cost plus that item\'s share of the shipping fee entered on the purchase order. So a delivery with a large shipping fee can raise a product\'s cost even when the supplier\'s unit price has not changed.',
          },
          {
            kind: 'note',
            variant: 'tip',
            text: 'Tip: This rule protects your selling price from dropping by accident when a supplier happens to give you one cheap delivery. If you genuinely want a product to cost or sell for less, change it yourself on the Products page — receiving a cheaper delivery alone will not do it.',
          },
          {
            kind: 'note',
            variant: 'warning',
            text: 'Warning: Your profit reports are not distorted by this rule. Each delivery is still stored as its own FIFO cost batch at the real price you actually paid, so batch and profit-margin reports show true costs. The highest-wins rule only affects the single headline cost and retail price shown on the product record.',
          },
        ],
      },
      {
        heading: 'Recording a bad order',
        blocks: [
          {
            kind: 'para',
            text: 'If goods arrive damaged, expired, or otherwise unusable, record them as a bad order rather than adjusting stock directly. This keeps a clear record for supplier claims and credits.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Purchases → Bad Orders.',
              'Click the button to record a new bad order.',
              'Select the supplier and purchase order the damaged goods came from, and list the affected items and quantities.',
              'Submit the report — it starts with "Reported" status and moves through "Return Requested", "Replaced", "Credited", or "Resolved" as it is worked through with the supplier.',
            ],
          },
          { kind: 'figure', slug: 'purchases-bad-orders' },
        ],
      },
      {
        heading: 'Managing suppliers',
        blocks: [
          {
            kind: 'para',
            text: 'The Supplier List holds every supplier\'s contact details, address, and payment terms.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Suppliers → Supplier List.',
              'Click "Add Supplier" to create a new one, filling in its name, contact number, address, and payment terms.',
              'Click a supplier row to edit its details, or use the "Export as CSV" or "Export as PDF" buttons to download the list.',
            ],
          },
          { kind: 'figure', slug: 'suppliers-list' },
        ],
      },
      {
        heading: 'Balance to supplier and payments',
        blocks: [
          {
            kind: 'para',
            text: 'The "Balance to Supplier" page shows how much your store currently owes each supplier, including overdue amounts, so you know who needs to be paid first.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Suppliers → Balance to Supplier to see the summary of what is owed.',
              'Click into a supplier\'s row to view their transaction history, or use the "Make Payment" action to record a payment against their balance.',
              'For paying several suppliers at once, use the bulk payment option after selecting multiple suppliers in the table.',
            ],
          },
          { kind: 'figure', slug: 'suppliers-balance' },
          {
            kind: 'para',
            text: 'Every payment you record here shows up under Suppliers → Payment Suppliers, which is a running log of all supplier payments made, searchable by date range and payment method.',
          },
          { kind: 'figure', slug: 'suppliers-payment' },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 6 — Customers
  // ────────────────────────────────────────────────────────────────────
  {
    number: 6,
    title: 'Customers',
    intro:
      'This chapter covers keeping a record of your regular customers, tracking what they owe on credit accounts, recording their payments, and managing loyalty points.',
    sections: [
      {
        heading: 'Managing the customer list',
        blocks: [
          {
            kind: 'para',
            text: 'The Customer List holds every registered customer\'s name, contact number, address, credit limit, and payment terms. Customers do not need to be registered here to buy at the counter — only customers who need a charge account, loyalty tracking, or special pricing.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Customer.',
              'Click "Add Customer" and fill in their name, contact number, address, and — if they are allowed to buy on credit — a credit limit and payment terms.',
              'Use the search box to find a customer by name or contact number.',
              'Click a customer row to edit their details.',
            ],
          },
          { kind: 'figure', slug: 'customer-list' },
        ],
      },
      {
        heading: 'Customer payments and statements',
        blocks: [
          {
            kind: 'para',
            text: 'The Customer Payments page has three tabs: "Outstanding Invoices" (unpaid charge sales awaiting payment), "Payment History" (every payment ever recorded), and "Statement of Account" (a printable statement for a single customer over a date range).',
          },
          {
            kind: 'steps',
            items: [
              'Go to Customer → Customer Payment.',
              'On the "Outstanding Invoices" tab, find the invoice you want to settle and click the "Record Payment" (banknote) icon on its row.',
              'Enter the amount received and confirm.',
              'To print a full statement for a customer, switch to "Statement of Account", pick the customer and a date range, then click "Generate Statement".',
            ],
          },
          { kind: 'figure', slug: 'customer-payment' },
        ],
      },
      {
        heading: 'Customer balances',
        blocks: [
          {
            kind: 'para',
            text: 'The Customer Balances page is a simple summary: every customer with an outstanding balance, how many invoices they have unpaid, and the total amount owed. Use this for a quick check of who owes money without digging into full invoice detail.',
          },
          { kind: 'figure', slug: 'customer-balances' },
        ],
      },
      {
        heading: 'Loyalty points',
        blocks: [
          {
            kind: 'para',
            text: 'The Customer Loyalty page manages loyalty cards and point balances. Each customer with a loyalty card can earn points on purchases and redeem them at the POS during checkout (see Chapter 2 — Taking Payment).',
          },
          {
            kind: 'steps',
            items: [
              'Go to Customer → Loyalty.',
              'Click "Add Loyalty Card" to register a new card for a customer.',
              'Use the row actions menu to "Edit Loyalty Card", "Adjust Points" (add or subtract points manually), "View History" (every point-earning and point-spending event), or "Delete" a card.',
              'Click "Loyalty Points Settings" to change how many points are earned per peso spent, store-wide.',
            ],
          },
          { kind: 'figure', slug: 'customer-loyalty' },
        ],
      },
      {
        heading: 'Membership fees',
        blocks: [
          {
            kind: 'para',
            text: 'A membership fee is what the customer pays to activate a new loyalty card, or to renew one that has run out. It is separate from the points described in the previous section: points are earned and redeemed on purchases, while the membership fee is what keeps the card itself valid for a set number of months. The fee amount and how long a membership lasts are both configured in Settings — see Chapter 9, POS setup.',
          },
          {
            kind: 'para',
            text: 'Cashiers collect membership fees at the counter, through the customer panel rather than the cart. A membership payment is never rung up as a cart item.',
          },
          {
            kind: 'steps',
            items: [
              'At the POS, click "Customer" along the bottom row of buttons.',
              'Select the customer. The Membership panel on the right shows their current status — "Active", "Expired", or "No Card" — along with the RFID code and expiry date when a card already exists.',
              'Click "Activate Membership" if the customer has no card yet, or "Renew Membership" if they already have one.',
              'For a new activation, scan or type the card number into "RFID Card Code". This is required — the payment cannot be confirmed without it. "Point Setting" is optional and can be left blank.',
              'Check the fee and the "Valid Until" date shown in the dialog. The validity is counted from today, not from the old expiry date.',
              'Choose "Cash" or "Card". For cash, enter the "Amount Tendered" and the change is worked out for you.',
              'Click "Confirm Payment". A membership receipt prints automatically.',
            ],
          },
          { kind: 'figure', slug: 'pos-membership-payment' },
          {
            kind: 'note',
            variant: 'warning',
            text: 'A membership fee is not a sale. It is not rung up through the cart, it has no sales invoice (SI) number, and it will not appear in any of the sales reports. To see membership money collected, use Reports → Membership. The cash from membership fees is still real cash in your drawer, so it is counted as part of your expected cash when you end your shift.',
          },
          {
            kind: 'note',
            variant: 'tip',
            text: 'If the dialog shows the fee as ₱0.00 and will not let you confirm, the membership fee has not been set up yet. An admin needs to set it in Settings → POS Setup → General before any membership can be sold.',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 7 — Approvals
  // ────────────────────────────────────────────────────────────────────
  {
    number: 7,
    title: 'Approvals',
    intro:
      'Certain changes in Verdix — purchase orders, stock counts, stock transfers, bad orders, and bulk adjustments — do not take effect immediately. They go through an approvals queue first, so a second person can review and confirm the change before it becomes final.',
    sections: [
      {
        heading: 'Working the Approvals board',
        blocks: [
          {
            kind: 'para',
            text: 'The Approvals page shows every pending request as a card, filterable by type: All, Adjust, POs, Transfers, Receive, Bad Order, Counts, Repack, Shelf, or Add Product. Each card shows what is being requested, who requested it, and what step of the approval workflow it is currently on.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Approvals.',
              'Use the type filter buttons to narrow the list to the kind of request you are reviewing.',
              'Click a card to open its details and see the full history of who has approved or rejected it so far.',
              'Approve or reject the request from the detail view. Rejected requests do not change stock or accounts; approved requests move to the next approval level, or are finalized if this was the last required level.',
            ],
          },
          { kind: 'figure', slug: 'approvals' },
          {
            kind: 'para',
            text: 'A request only affects real stock or account balances once it has passed every required approval level and is finalized. Until then it sits as "pending" and has no effect on the numbers shown elsewhere in the system.',
          },
        ],
      },
      {
        heading: 'Configuring approval workflows',
        blocks: [
          {
            kind: 'para',
            text: 'The Workflow Settings page controls which transaction types require approval, how many levels of approval each one needs, and which roles are allowed to approve at each level. This is a setup task done once by an admin, not a day-to-day cashier task.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Approvals → Workflow Settings.',
              'Choose the transaction type you want to configure (for example Stock Adjustment or Purchase Order).',
              'Set how many approval levels are required and which role is responsible for each level.',
              'Save your changes. New requests of this type will now follow the updated workflow; requests already pending keep the workflow that was active when they were created.',
            ],
          },
          { kind: 'figure', slug: 'approvals-settings' },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 8 — Reports
  // ────────────────────────────────────────────────────────────────────
  {
    number: 8,
    title: 'Reports',
    intro:
      'Verdix includes a large library of reports covering sales, inventory, purchases, and compliance. Rather than walking through each one individually, this chapter shows you how to get to the Reports hub and gives you an index of every available report and what it is for.',
    sections: [
      {
        heading: 'The Reports hub',
        blocks: [
          {
            kind: 'para',
            text: 'All reports are reached from a single hub page, organized into categories such as Sales, Purchases, Inventory, and Compliance. Click any report tile to open it, then use its own filters (usually a date range and sometimes a product, customer, or supplier filter) to narrow the results.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Reports from the sidebar.',
              'Click the report you need from the hub.',
              'Set the date range or other filters at the top of the report.',
              'Most reports offer an export or print option once the data is loaded.',
            ],
          },
          { kind: 'figure', slug: 'reports-hub' },
        ],
      },
      {
        heading: 'Two commonly used reports',
        blocks: [
          {
            kind: 'para',
            text: 'The two reports below are used often enough that most stores check them daily. Both are also listed in the full index at the end of this chapter.',
          },
          { kind: 'figure', slug: 'reports-sales-summary' },
          {
            kind: 'para',
            text: 'Sales Summary gives a top-level view of a day\'s or period\'s total sales, useful for a quick daily check against your cash drawer count.',
          },
          { kind: 'figure', slug: 'reports-low-stock' },
          {
            kind: 'para',
            text: 'Low Stock lists every product that has fallen below its reorder point — check this before creating purchase orders so nothing is missed.',
          },
        ],
      },
      {
        heading: 'Full report index',
        blocks: [
          {
            kind: 'para',
            text: 'The table below lists every report available in Verdix POS, with the menu path and a one-line description of what it shows.',
          },
          {
            kind: 'table',
            headers: ['Report', 'Route', 'Purpose'],
            rows: [
              ['Sales Summary', '/reports/sales/summary', 'Total sales for a chosen period, broken down by day.'],
              ['Sales by Product/Service', '/reports/sales/by-product', 'How much of each product or service sold and its revenue.'],
              ['Sales by Customer', '/reports/sales/by-customer', 'Total sales grouped by customer, useful for tracking your best accounts.'],
              ['Top Sales', '/reports/sales/top-sales', 'Best-selling products ranked by revenue.'],
              ['Top Volume', '/reports/sales/top-volume', 'Best-selling products ranked by quantity sold.'],
              ['Profit Margin', '/reports/sales/profit-margin', 'Profit margin per product, comparing cost against selling price.'],
              ['Batch Profit', '/reports/sales/batch-profit', 'Profit calculated per FIFO cost batch, showing which stock batches were most profitable.'],
              ['Discounts', '/reports/sales/discounts', 'All discounts given, by cashier, product, or period.'],
              ['Split Payments', '/reports/sales/split-payments', 'Sales paid using more than one payment method.'],
              ['Returns', '/reports/sales/returns', 'Merchandise credits and returned items.'],
              ['BIR Summary', '/reports/sales/bir-summary', 'Official BIR-format summary of sales invoice numbers and totals for tax filing.'],
              ['Purchases Summary', '/reports/purchases/summary', 'Total purchase spend for a chosen period.'],
              ['Purchases by Supplier', '/reports/purchases/by-supplier', 'Purchases grouped by supplier, showing who you buy the most from.'],
              ['Purchases by Product', '/reports/purchases/by-product', 'Purchases grouped by product, showing what you restock most often.'],
              ['Inventory', '/reports/inventory', 'A full snapshot of current stock levels across all products.'],
              ['Low Stock', '/reports/low-stock', 'Products that have fallen below their reorder point and need restocking.'],
              ['Expiring Soon', '/reports/expiring-soon', 'Products approaching their expiration date, so they can be sold or pulled first.'],
              ['Cost vs Retail', '/reports/cost-vs-retail', 'Side-by-side comparison of product cost and retail price to check markups.'],
              ['Movements', '/reports/movements', 'Full log of every stock movement — sales, purchases, transfers, and adjustments.'],
              ['Adjustments', '/reports/adjustments', 'Manual stock adjustments only, with reasons and approval status.'],
              ['Velocity', '/reports/velocity', 'How fast each product sells, useful for planning reorder quantities.'],
              ['Membership', '/reports/membership', 'Membership activations and renewals, with amount, payment method, cashier, and how long each membership runs.'],
              ['Fiscal Year', '/reports/fiscal-year', 'Summary figures aligned to your store\'s configured fiscal year.'],
            ],
          },
          { kind: 'figure', slug: 'reports-membership' },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────
  // Chapter 9 — Settings & Users
  // ────────────────────────────────────────────────────────────────────
  {
    number: 9,
    title: 'Settings & Users',
    intro:
      'This chapter covers store-wide configuration — POS terminals, tax rates, and general settings — plus managing the user accounts allowed to log in to Verdix. These pages are for admins only and change how the whole system behaves, so treat them carefully.',
    sections: [
      {
        heading: 'The Settings hub',
        blocks: [
          {
            kind: 'para',
            text: 'Settings is organized into tiles, each opening a focused settings area: System Preferences, Notifications, Appearance, Data Management, POS Setup, Tax Rates, Pricing Configuration, Cache & Refresh, and External API Integration.',
          },
          { kind: 'figure', slug: 'settings' },
          {
            kind: 'para',
            text: 'Click any tile to open that settings area. The two most commonly used areas for day-to-day store operation — POS Setup and Tax Rates — are covered in more detail below.',
          },
        ],
      },
      {
        heading: 'POS setup',
        blocks: [
          {
            kind: 'para',
            text: 'POS Setup configures how the checkout counter behaves. It is organized into tabs: Business (store name, logo, address), General (display and behavior options), Security, Confirmations (which actions require an extra confirmation step), BIR (Philippine tax compliance settings), and Data.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Settings → POS Setup.',
              'Choose the tab for the setting you need to change.',
              'Make your changes, then click "Save Settings" at the top of the page.',
            ],
          },
          { kind: 'figure', slug: 'settings-pos-setup' },
          {
            kind: 'para',
            text: 'The General tab also holds the Membership settings, which control what customers pay for a loyalty card and how long that card stays valid. Cashiers cannot collect a membership fee until these are set.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Settings → POS Setup and open the "General" tab.',
              'Set "Membership Fee (₱)" — the amount charged to activate or renew a customer\'s loyalty card.',
              'Set "Membership Duration (months)" — how long a paid membership lasts, counted from the day it is paid. The default is 12 months.',
              'Click "Save Settings" at the top of the page.',
            ],
          },
          { kind: 'figure', slug: 'settings-membership' },
          {
            kind: 'note',
            variant: 'tip',
            text: 'Leaving the membership fee at ₱0.00 stops cashiers from selling memberships altogether — the payment dialog at the POS refuses to confirm and points back to this tab. Set a real amount before the store starts offering memberships.',
          },
        ],
      },
      {
        heading: 'Managing POS terminals',
        blocks: [
          {
            kind: 'para',
            text: 'Each physical checkout counter in your store is registered as a terminal. This lets Verdix track which terminal a sale happened on and which warehouse it draws stock from.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Settings → POS Terminals.',
              'Click the button to add a new terminal and give it a description and warehouse.',
              'Use the edit action on an existing terminal card to change its details, or the delete action to remove a terminal that is no longer in use.',
              'If a terminal shows a connection problem, use "Reset Connection" to clear the current link before reconnecting.',
            ],
          },
          { kind: 'figure', slug: 'settings-pos-terminals' },
        ],
      },
      {
        heading: 'Tax rates',
        blocks: [
          {
            kind: 'para',
            text: 'The Tax Rates page manages the VAT and other tax rates applied to sales, plus your store\'s VAT registration type, which controls whether receipts print "VAT REG TIN" or "NON-VAT REG TIN" in the header.',
          },
          {
            kind: 'steps',
            items: [
              'Go to Settings → Tax Rates. If your store requires authentication for this page, enter admin credentials when prompted.',
              'Click the "Add Tax Rate" button, or use the edit action on an existing rate.',
              'Set the "Registration Type" to "VAT Registered" or "Non-VAT Registered" as applicable to your store.',
            ],
          },
          { kind: 'figure', slug: 'settings-tax-rates' },
          {
            kind: 'note',
            variant: 'warning',
            text: 'Sales invoice (SI) numbers printed on receipts must be sequential with no gaps and no duplicates — this is a legal requirement for Philippine BIR tax filing. Do not attempt to renumber, delete, or reuse an invoice number; the system enforces sequential numbering automatically, so changes here should only ever add new tax rates, not alter existing invoice history.',
          },
        ],
      },
      {
        heading: 'User management',
        blocks: [
          {
            kind: 'para',
            text: 'User Management controls who can log in to Verdix, what permissions they have, and lets you review an activity log of what every user has done across the system.',
          },
          {
            kind: 'steps',
            items: [
              'Go to User Management.',
              'Click the "Add User" button, filling in their name, username, password, and user type.',
              'Use "Manage User Types" if you need to create or edit the permission sets assigned to users (for example Admin, Manager, Cashier).',
              'Click a user\'s row actions to edit their details or deactivate their account.',
              'Switch to the "Activity Logs" tab to see an audit trail of actions taken across Inventory, Sales, Customers, Purchases, Suppliers, Products, and more.',
            ],
          },
          { kind: 'figure', slug: 'user-management' },
          {
            kind: 'note',
            variant: 'tip',
            text: 'Users with a "Cashier" or "Employee" user type are automatically sent to the POS screen on login (Chapter 2), not the back office — this is expected behavior, not an error.',
          },
        ],
      },
    ],
  },
];
