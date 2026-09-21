import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../lib/mysql';
import { DEFAULT_UNITS_OF_MEASURE } from '../../../../lib/default-units';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ success: false, error: 'Action is required' }, { status: 400 });
    }

    if (action === 'clear_sales') {
      await withTransaction(async (connection) => {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        
        try {
          const tablesToClear = [
            'pos_transaction_items',
            'pos_transactions',
            'payment_details',
            'payment_audit_log',
            'sale_items',
            'sales_transactions',
            'sales_order_items',
            'sales_orders',
            'sales_order_status_history',
            'sales_invoice_items',
            'sales_invoices',
            'customer_payments',
            'cash_transfers',
            'point_history',
            'bad_order_items',
            'bad_orders',
            'shifts',
            'x_readings',
            'z_readings',
            // Purchase orders — grouped with sales here because they are the
            // other half of a store's transaction history; inventory itself
            // (products, stock, batches) is untouched and stays under
            // clear_inventory / factory_reset.
            'purchase_order_items',
            'purchase_order_payments',
            'purchase_orders'
          ];

          for (const table of tablesToClear) {
            try {
              await connection.query(`TRUNCATE TABLE ${table}`);
            } catch (e) {
              console.log(`Table ${table} missing, skipping...`);
            }
          }

          // Clear approval queue items related to sales and purchase orders
          await connection.query("DELETE FROM approval_queue WHERE transaction_type IN ('SALES_ORDER', 'SALES_INVOICE', 'BAD_ORDER', 'PURCHASE_ORDER', 'RECEIVE_PO')");
          await connection.query("DELETE FROM approval_history WHERE approval_queue_id NOT IN (SELECT id FROM approval_queue)");

          // With all sales gone, restart invoice/receipt numbering so the next
          // sale is SI 000001 (si_number '000000' — getNextSINumber increments
          // then reads). Terminal OR and X/Z counters reset too.
          await connection.query("UPDATE transaction_references SET si_number = '000000' WHERE id = 1");
          await connection.query('UPDATE pos_terminals SET or_next_reference = "000001", x_counter = 0, z_counter = 0');

        } finally {
          await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        }
      });

      return NextResponse.json({ success: true, message: 'Sales and transaction data cleared successfully' });

    } else if (action === 'reset_references') {
      await withTransaction(async (connection) => {
         await connection.query('TRUNCATE TABLE transaction_references');

         // si_number starts at '000000' — getNextSINumber increments-then-reads,
         // so the first invoice after a reset is 000001.
         await connection.query(`
            INSERT INTO transaction_references (
              sales_order, purchase_order, sales_delivery, payment_to_supplier,
              sales_invoice, customer_payment, delivery_receipt, stock_adjustment, sales_hold,
              receipt_number, si_number
            ) VALUES ('1000', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '00000001', '000000')
         `);

         // Also reset terminal counters if possible
         await connection.query('UPDATE pos_terminals SET or_next_reference = "000001", x_counter = 0, z_counter = 0');
      });

      return NextResponse.json({ success: true, message: 'Transaction references and terminal counters reset' });

    } else if (action === 'clear_inventory') {
      await withTransaction(async (connection) => {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
           const tablesToClear = [
             'purchase_order_items',
             'purchase_orders',
             'purchase_order_payments',
             'supplier_payments',
             'stock_movements',
             'stock_adjustments',
             'stock_counts',
             'stock_count_items',
             'inventory_transfers',
             'inventory_transfer_items',
             'inventory_batches',
             'repackaging_logs',
             'product_price_levels',
             'supplier_product_mapping',
             'product_shelves',
             'conversion_factors'
           ];

           for (const table of tablesToClear) {
             try {
               await connection.query(`TRUNCATE TABLE ${table}`);
             } catch (e) {
               console.log(`Table ${table} missing, skipping...`);
             }
           }

           await connection.query('TRUNCATE TABLE products');
           
           // Clear approval queue items related to inventory
           await connection.query("DELETE FROM approval_queue WHERE transaction_type IN ('STOCK_ADJUSTMENT', 'STOCK_TRANSFER', 'PURCHASE_ORDER', 'RECEIVE_PO', 'SHELF_TRANSFER')");
           await connection.query("DELETE FROM approval_history WHERE approval_queue_id NOT IN (SELECT id FROM approval_queue)");

        } finally {
           await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        }
      });
      
      return NextResponse.json({ success: true, message: 'Inventory records and products cleared' });

    } else if (action === 'clear_master_data') {
      await withTransaction(async (connection) => {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
          const tablesToClear = [
            'customers',
            'customer_loyalty',
            'suppliers',
            'categories',
            'brands',
            'subcategories',
            'units_of_measure',
            'shelf_locations',
            'departments',
            'sales_persons',
            'warehouses'
          ];

          for (const table of tablesToClear) {
            try {
              await connection.query(`TRUNCATE TABLE ${table}`);
            } catch (e) {
              console.log(`Table ${table} missing, skipping...`);
            }
          }

          // Re-insert default STORE warehouse
          await connection.query(
            "INSERT IGNORE INTO warehouses (id, name, location, is_active, is_main) VALUES (?, ?, ?, ?, ?)",
            ['wh_main', 'STORE', 'Main Store', 1, 1]
          );

          // Re-insert default units of measure so they survive the reset
          for (const u of DEFAULT_UNITS_OF_MEASURE) {
            await connection.query(
              'INSERT IGNORE INTO units_of_measure (id, name, abbreviation) VALUES (?, ?, ?)',
              [u.id, u.name, u.abbreviation]
            );
          }
        } finally {
          await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        }
      });

      return NextResponse.json({ success: true, message: 'Master data (Customers, Suppliers, Sales Persons, etc.) cleared' });

    } else if (action === 'factory_reset') {
      await withTransaction(async (connection) => {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
          const allTables = [
            // Sales
            'pos_transaction_items', 'pos_transactions', 'payment_details', 'payment_audit_log',
            'sale_items', 'sales_transactions', 'sales_order_items', 'sales_orders',
            'sales_order_status_history', 'sales_invoice_items', 'sales_invoices',
            'customer_payments', 'cash_transfers', 'point_history', 'bad_order_items', 'bad_orders',
            'shifts', 'x_readings', 'z_readings',
            // Inventory
            'purchase_order_items', 'purchase_orders', 'purchase_order_payments', 'supplier_payments',
            'stock_movements', 'stock_adjustments', 'stock_counts', 'stock_count_items',
            'inventory_transfers', 'inventory_transfer_items', 'inventory_batches', 'repackaging_logs',
            'product_price_levels', 'supplier_product_mapping', 'product_shelves',
            'conversion_factors', 'products', 'warehouses',
            // Master Data
            'customers', 'customer_loyalty', 'loyalty_points_settings', 'suppliers', 'categories', 'brands', 'subcategories',
            'units_of_measure', 'shelf_locations', 'departments', 'sales_persons',
            // Approvals
            'approval_queue', 'approval_history', 'approval_workflows',
            // POS Setup & System configuration
            'pos_settings', 'pos_terminals', 'payment_methods', 'payment_terms', 'payment_term_types', 'price_levels' 
          ];

          for (const table of allTables) {
            try {
              await connection.query(`TRUNCATE TABLE ${table}`);
            } catch (e) {
              console.log(`Table ${table} missing or could not be truncated, skipping...`);
            }
          }

          // 1. Reset POS Settings to defaults
          await connection.query(`
            INSERT INTO pos_settings (
              id, business_name, transaction_prefix, currency_symbol, currency_code, 
              timezone, date_format, enable_automatic_markup, default_markup_percentage, 
              markup_priority, show_quantity_in_search, low_stock_threshold, 
              native_printer_name, paper_size, print_mode
            ) VALUES (
              'pos_settings_1', 'My Business', 'TXN', '₱', 'PHP', 
              'Asia/Manila', 'MM/DD/YYYY', 1, 0.00, 
              '["subcategory", "category", "brand", "supplier"]', 1, 10,
              'XP-58-P', '58mm', 'browser'
            )
          `);

          // 2. Insert default Payment Methods
          const defaultPaymentMethods = [
            ['pm_cash', 'Cash', 1],
            ['pm_credit_card', 'Credit Card', 1],
            ['pm_bank_transfer', 'Bank Transfer', 1],
            ['pm_paypal', 'PayPal', 1],
            ['pm_gcash', 'GCash', 1],
            ['pm_check', 'Check', 1]
          ];
          for (const pm of defaultPaymentMethods) {
            await connection.query('INSERT INTO payment_methods (id, name, is_active) VALUES (?, ?, ?)', pm);
          }

          // 3. Insert default Price Level
          await connection.query('INSERT INTO price_levels (id, name, description, is_default, percentage_adjustment) VALUES (?, ?, ?, ?, ?)', 
            ['retail-level', 'Retail', 'Standard retail price', 1, 100.00]);

          // 4. Insert default STORE warehouse
          await connection.query(
            "INSERT IGNORE INTO warehouses (id, name, location, is_active, is_main) VALUES (?, ?, ?, ?, ?)",
            ['wh_main', 'STORE', 'Main Store', 1, 1]
          );

          // 5. Re-insert default units of measure so they survive a factory reset
          for (const u of DEFAULT_UNITS_OF_MEASURE) {
            await connection.query(
              'INSERT IGNORE INTO units_of_measure (id, name, abbreviation) VALUES (?, ?, ?)',
              [u.id, u.name, u.abbreviation]
            );
          }

          // User Management Reset (Keep Admin users)
          // 1. Get Admin/Super Admin role IDs
          const [adminRoles]: any = await connection.query(
            "SELECT id FROM user_types WHERE name IN ('Admin', 'Super Admin')"
          );
          const adminRoleIds = adminRoles.map((r: any) => r.id);

          if (adminRoleIds.length > 0) {
            // 2. Delete permissions for non-admin users
            await connection.query(
              `DELETE FROM user_permissions WHERE user_uid NOT IN (SELECT uid FROM users WHERE user_type IN (?) OR username = 'admin')`,
              [adminRoleIds]
            );
            
            // 3. Delete non-admin users
            await connection.query(
              `DELETE FROM users WHERE user_type NOT IN (?) AND username != 'admin'`,
              [adminRoleIds]
            );
          } else {
            // Fallback: Delete all users except 'admin' if roles can't be found
            await connection.query(
              `DELETE FROM user_permissions WHERE user_uid NOT IN (SELECT uid FROM users WHERE username = 'admin')`
            );
            await connection.query(
              `DELETE FROM users WHERE username != 'admin'`
            );
            console.warn("Could not identify Admin roles, using username fallback to preserve 'admin' account.");
          }

          // Reset references — si_number '000000' so the first invoice is 000001.
          await connection.query('TRUNCATE TABLE transaction_references');
          await connection.query(`
            INSERT INTO transaction_references (
              sales_order, purchase_order, sales_delivery, payment_to_supplier,
              sales_invoice, customer_payment, delivery_receipt, stock_adjustment, sales_hold,
              receipt_number, si_number
            ) VALUES ('1000', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '1000', '00000001', '000000')
          `);

        } finally {
          await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        }
      });

      return NextResponse.json({ success: true, message: 'System fully reset to initial state including POS setup' });

    } else {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

  } catch (error: any) {
    console.error('Error in reset API:', error);
    return NextResponse.json({ success: false, error: error.message || 'An error occurred' }, { status: 500 });
  }
}
