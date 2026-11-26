import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../lib/mysql';
import { DEFAULT_UNITS_OF_MEASURE } from '../../../../lib/default-units';
import { runFactoryReset } from '../../../../lib/factory-reset';

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
            'z_readings'
            // Purchase orders are NOT cleared here — they have their own
            // clear_purchase_orders action so a store can wipe sales history
            // while keeping its supplier/PO records, or vice versa.
          ];

          for (const table of tablesToClear) {
            try {
              await connection.query(`TRUNCATE TABLE ${table}`);
            } catch (e) {
              console.log(`Table ${table} missing, skipping...`);
            }
          }

          // Clear approval queue items related to sales
          await connection.query("DELETE FROM approval_queue WHERE transaction_type IN ('SALES_ORDER', 'SALES_INVOICE', 'BAD_ORDER')");
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

    } else if (action === 'clear_purchase_orders') {
      await withTransaction(async (connection) => {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
          // supplier_payments goes with the POs: a supplier's balance is
          // (PO totals − payments), so dropping the POs while keeping the
          // payments would leave every supplier showing a phantom credit.
          // Stock received through these POs, and the inventory_batches that
          // carry its cost, are untouched.
          const tablesToClear = [
            'purchase_order_items',
            'purchase_order_payments',
            'purchase_orders',
            'supplier_payments'
          ];

          for (const table of tablesToClear) {
            try {
              await connection.query(`TRUNCATE TABLE ${table}`);
            } catch (e) {
              console.log(`Table ${table} missing, skipping...`);
            }
          }

          await connection.query("DELETE FROM approval_queue WHERE transaction_type IN ('PURCHASE_ORDER', 'RECEIVE_PO')");
          await connection.query("DELETE FROM approval_history WHERE approval_queue_id NOT IN (SELECT id FROM approval_queue)");
        } finally {
          await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        }
      });

      return NextResponse.json({ success: true, message: 'Purchase orders and supplier payments cleared' });

    } else if (action === 'reset_stock') {
      const affected = await withTransaction(async (connection) => {
        // Lock every product row up front, in id order — the same order
        // checkout locks in — so a sale that lands mid-reset waits for us
        // instead of having its deduction overwritten (or deadlocking).
        await connection.query('SELECT id FROM products ORDER BY id FOR UPDATE');

        // History is KEPT. Each product that still had stock gets one
        // 'adjustment' movement taking it to zero, so the movement ledger
        // still sums to the current figure and the reset is visible in it.
        const resetId = `RESET-${Date.now()}`;
        const [ins]: any = await connection.query(
          `INSERT INTO stock_movements (
             id, product_id, product_name, movement_type, quantity_change,
             previous_stock, new_stock, reference_id, reference_type, notes
           )
           SELECT UUID(), id, COALESCE(name, ''), 'adjustment', -stock,
                  stock, 0, ?, 'adjustment', 'Stock reset to zero (Data Management)'
           FROM products
           WHERE stock <> 0`,
          [resetId]
        );

        await connection.query('UPDATE products SET stock = 0, updated_at = CURRENT_TIMESTAMP WHERE stock <> 0');

        // Empty the FIFO batches rather than deleting them: the rows stay as
        // cost history, but nothing remains to deplete, so the first stock
        // received after the reset is costed fresh.
        await connection.query('UPDATE inventory_batches SET quantity_remaining = 0 WHERE quantity_remaining <> 0');
        try {
          await connection.query('UPDATE product_shelves SET quantity = 0 WHERE quantity <> 0');
        } catch (e) {
          console.log('Table product_shelves missing, skipping...');
        }

        // products.expiration_date is a cache of the nearest expiry among
        // batches that still hold stock (lib/expiration.ts). With every batch
        // empty that is NULL — clear it so zero-stock items stop showing as
        // expiring.
        await connection.query('UPDATE products SET expiration_date = NULL WHERE expiration_date IS NOT NULL');

        return ins?.affectedRows ?? 0;
      });

      return NextResponse.json({ success: true, message: `Stock reset to zero for ${affected} product(s). Products, prices and stock history were kept.` });

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
             'product_selling_unit_price_levels',
             'product_selling_units',
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
      // Same state as a fresh install — see lib/factory-reset.ts. Every user
      // account goes, including admins; the installer's default admin comes
      // back with its default password. The licence and the migrations
      // history are kept.
      const result = await runFactoryReset();
      console.log('[FactoryReset]', result);

      return NextResponse.json({ success: true, message: 'System reset to a fresh install. Log in again with the default admin account.' });

    } else {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

  } catch (error: any) {
    console.error('Error in reset API:', error);
    return NextResponse.json({ success: false, error: error.message || 'An error occurred' }, { status: 500 });
  }
}
