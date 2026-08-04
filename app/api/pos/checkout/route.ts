import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, getNextReference, getNextReceiptNumber, getNextSINumber, formatSINumber } from '@/lib/mysql';
import { deductFamilyStock, findUltimateRoot } from '@/lib/family-sync';
import { deductFromBatches, getBatchCostingSettings } from '@/lib/batch-deduction';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';
import { query } from '@/lib/mysql';
import { isService } from '@/lib/product-type';
import { resolveEffectiveTaxType } from '@/lib/tax-utils';

// Cached per process — the columns can't disappear once ensured, so don't pay
// an INFORMATION_SCHEMA round trip on every checkout.
let posItemsSchemaEnsured = false;

async function ensurePosTransactionItemsSchema() {
  if (posItemsSchemaEnsured) return;
  try {
    const currentColumnsResult = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_transaction_items' AND TABLE_SCHEMA = DATABASE()"
    ) as any[];
    const existingColumns = new Set(currentColumnsResult.map((c: any) => c.COLUMN_NAME));

    if (!existingColumns.has('discount_type')) {
      await query("ALTER TABLE pos_transaction_items ADD COLUMN discount_type VARCHAR(50) DEFAULT 'percent'");
      console.log('✅ Added discount_type column to pos_transaction_items');
    }
    if (!existingColumns.has('tax_type')) {
      await query("ALTER TABLE pos_transaction_items ADD COLUMN tax_type VARCHAR(50) DEFAULT 'VAT'");
      console.log('✅ Added tax_type column to pos_transaction_items');
    }
    if (!existingColumns.has('discount_id_number')) {
      await query("ALTER TABLE pos_transaction_items ADD COLUMN discount_id_number VARCHAR(100) DEFAULT NULL");
      console.log('✅ Added discount_id_number column to pos_transaction_items');
    }
    if (!existingColumns.has('discount_holder_name')) {
      await query("ALTER TABLE pos_transaction_items ADD COLUMN discount_holder_name VARCHAR(255) DEFAULT NULL");
      console.log('✅ Added discount_holder_name column to pos_transaction_items');
    }
    posItemsSchemaEnsured = true;
  } catch (error) {
    console.error('Error ensuring pos_transaction_items schema:', error);
  }
}


export async function POST(request: NextRequest) {
  try {
    await ensurePosTransactionItemsSchema();
    await ensureCustomerCreditColumn();
    const body = await request.json();

    const {
      items,
      customer,
      paymentMethod,
      totalDue,
      userId,
      shiftId,
      terminalId,
      notes,
      // Payment-specific data
      paymentDetails,
      amountTendered,
      change
    } = body;
    
    console.log('[POS Checkout] Processing sale:', { itemsCount: items.length, totalDue, paymentMethod });
    items.forEach((it: any) => console.log(`  - Item: ${it.name}, Qty: ${it.quantity}, ID: ${it.id}`));

    if (!items || items.length === 0) {
      return NextResponse.json({ success: false, error: 'No items in transaction' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    if (paymentMethod?.toUpperCase() === 'CHARGE' && (!customer || customer.id === 'walk-in')) {
      return NextResponse.json({ success: false, error: 'Customer is required for Charge to Account' }, { status: 400 });
    }

    // Generate IDs
    const saleId = `SALE-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const posTransId = `PT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const paymentDetailsId = `PD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const auditLogId = `PAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    return await withTransaction(async (connection) => {
      // Fetch Loyalty & Training Mode Settings
      const [loyaltyRows]: any = await connection.query(
        'SELECT * FROM loyalty_points_settings LIMIT 1'
      );
      const [posSettingsRows]: any = await connection.query(
        'SELECT is_training_mode FROM pos_settings LIMIT 1'
      );
      
      const loyaltySettings = loyaltyRows || [];
      const isTrainingMode = posSettingsRows?.[0]?.is_training_mode || false;
      let eligiblePointsAmount = 0;

      // Log payment initiation

      await connection.query(`
        INSERT INTO payment_audit_log (
          id, transaction_id, payment_method, action, status, amount, user_id, created_at
        ) VALUES (?, ?, ?, 'initiated', 'pending', ?, ?, NOW())
      `, [auditLogId, posTransId, paymentMethod, totalDue, userId]);
      // Generate sequential reference (INV-XXXXXX). All three counters run on
      // THIS transaction: fewer round trips, and a rolled-back sale releases
      // its numbers instead of leaving gaps.
      const nextRefVal = await getNextReference('sales_invoice', connection);
      const sequentialRef = `INV-${nextRefVal.toString().padStart(6, '0')}`;

      // Get terminal specific receipt (OR)
      const receiptNo = await getNextReceiptNumber(terminalId, connection);

      // Get next SI Number (consolidated sequence number). Training-mode sales are
      // excluded from official BIR totals, so they must not burn a real SI number —
      // doing so would create unexplained jumps in the filed sequence.
      const siNumber = isTrainingMode ? null : await getNextSINumber(connection);

      const isCharge = typeof paymentMethod === 'string' && paymentMethod.toUpperCase() === 'CHARGE';
      const invoiceStatus = isCharge ? 'Pending' : 'Paid';
      const posPaymentStatus = isCharge ? 'pending' : 'completed';

      // 1. Insert into sales_transactions
      const insertSaleSql = `
        INSERT INTO sales_transactions (
          id, reference, receipt_number, si_number, customer_id, invoice_date, date, total, payment_method, status, transaction_source, notes, is_training, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, CURDATE(), CURDATE(), ?, ?, ?, 'POS', ?, ?, NOW(), NOW())
      `;
      await connection.query(insertSaleSql, [
        saleId,
        sequentialRef,
        receiptNo,
        siNumber,
        (customer && customer.id !== 'walk-in') ? customer.id : null,
        totalDue,
        paymentMethod,
        invoiceStatus,
        notes || 'POS Sale',
        isTrainingMode
      ]);

      // 2a. Fetch batch costing settings once (do it once before the loop for efficiency)
      // We'll store it in a variable accessible inside the loop.
      let _batchSettings: { repackInherit: boolean; oversellBlock: boolean } | null = null;
      const getBCS = async () => {
        if (!_batchSettings) _batchSettings = await getBatchCostingSettings(connection as any);
        return _batchSettings;
      };

      // 2. Deduct batches + stock and insert sale_items (cost folded into the
      //    insert — no separate UPDATE per item).
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = `${saleId}-ITEM-${i + 1}`;

        // Loaded before batch costing because `type` decides whether we deduct
        // at all. Same single query that already served loyalty + family sync.
        const [soldProdResult]: any = await connection.query(`
          SELECT
            p.id, p.parent_id, p.unit_of_measure, p.name, p.stock, p.type, p.cost,
            c.markup_percentage, p.category, p.earns_points
          FROM products p
          LEFT JOIN categories c ON p.category = c.name
          WHERE p.id = ?
        `, [item.id]);

        const soldProd = soldProdResult?.[0];
        const itemIsService = soldProd ? isService(soldProd) : false;

        // --- BATCH COSTING: FIFO deduction & cost recording ---
        let costAtSale: number | null = null;
        let batchSource: string | null = null;

        if (itemIsService) {
          // Services have no batches. Cost is the fixed value on the product,
          // so sale_items.cost_at_sale stays populated and profit reports work
          // identically for services and standard goods.
          costAtSale = soldProd?.cost != null ? parseFloat(soldProd.cost) : 0;
          batchSource = null;
        } else {
          try {
            const bcs = await getBCS();
            const deduction = await deductFromBatches(
              item.id,
              item.quantity,
              bcs.oversellBlock,
              connection as any
            );
            costAtSale = deduction.weightedAvgCost;
            batchSource = JSON.stringify(deduction.splits);
          } catch (batchErr: any) {
            // If oversell_block is ON, rethrow to abort the transaction
            if (batchErr.message && batchErr.message.startsWith('Batch stock exhausted')) {
              throw batchErr;
            }
            // Otherwise non-fatal (e.g. migration not yet run) — log and continue
            console.warn('[BatchCosting] Could not deduct batch (migration pending?):', batchErr.message);
          }
        }
        // --- END BATCH COSTING ---

        await connection.query(`
          INSERT INTO sale_items (
            id, sale_id, product_id, product_name, quantity, price, cost_at_sale, batch_source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          itemId,
          saleId,
          item.id,
          item.name,
          item.quantity,
          item.price * (1 - (item.discount || 0) / 100),
          costAtSale,
          batchSource
        ]);

        // --- Stock Deduction with Full Hierarchy Sync & Loyalty Calculation ---
        if (soldProd) {
          // Loyalty Points Calculation — applies to services too.
          const hasFivePercentMarkup = Math.abs((soldProd.markup_percentage || 0) - 5) < 0.01;
          const earnsPointsEnabled = soldProd.earns_points !== 0 && soldProd.earns_points !== false;
          const isExcluded = hasFivePercentMarkup || !earnsPointsEnabled;
          if (!isExcluded) {
             eligiblePointsAmount += item.price * item.quantity;
          } else {
             console.log(`Item ${item.name} excluded from points. Markup: ${soldProd.markup_percentage}, Earns: ${soldProd.earns_points}`);
          }

          // Services carry no stock and belong to no family — nothing to sync.
          if (!itemIsService) {
            // Walk the FULL ancestor chain to find the ultimate root and the
            // cumulative factor (handles grandchildren, great-grandchildren, etc.)
            // Products with no parent ARE the root — skip the walk entirely.
            //
            // Example — selling Sugar 500g (grandchild):
            //   findUltimateRoot(Sugar500g)
            //     → rootId = Sugar25kg, factorToRoot = 50
            //   rootQty = 10 Sugar500g / 50 = 0.2 Sugar25kg
            //   deductFamilyStock(Sugar25kg, 0.2) then cascades:
            //     → deduct 0.2 from Sugar25kg
            //     → find Sugar1kg (factor 25) → deduct 5 from Sugar1kg
            //         → find Sugar500g (factor 2) → deduct 10 from Sugar500g ✓
            const { rootId, factorToRoot } = soldProd.parent_id
              ? await findUltimateRoot(soldProd.id, connection)
              : { rootId: soldProd.id, factorToRoot: 1 };

            if (factorToRoot > 1 || rootId !== soldProd.id) {
              // Sold item is NOT the root — convert qty to root units and deduct from root down
              const rootQty = item.quantity / factorToRoot;
              await deductFamilyStock(
                rootId,
                rootQty,
                saleId,
                'sale',
                `POS Sale: ${saleId} (sold: ${soldProd.name}, syncing full tree)`,
                connection
              );
            } else {
              // Sold item IS the root — deduct and propagate to all descendants
              await deductFamilyStock(
                soldProd.id,
                item.quantity,
                saleId,
                'sale',
                `POS Sale: ${saleId}`,
                connection
              );
            }
          }
        }

      }

      // 3. Insert into sales_invoices (to show up in /sales reports)
      const invoiceId = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      
      let dueDateQuery = 'CURDATE()';
      
      if (isCharge && customer && customer.id !== 'walk-in') {
          // Fetch customer's payment terms
          const [custTermResult]: any = await connection.query(
               'SELECT payment_terms FROM customers WHERE id = ?', 
               [customer.id]
          );
          
          if (custTermResult && custTermResult.length > 0) {
              const terms = custTermResult[0].payment_terms; // e.g., '15 Days', '30 Days', 'Cash'
              
              if (terms && typeof terms === 'string') {
                  const match = terms.match(/(\d+)/);
                  if (match && match[1]) {
                      const days = parseInt(match[1]);
                      dueDateQuery = `DATE_ADD(CURDATE(), INTERVAL ${days} DAY)`;
                  }
              }
          }
      }
      
      // Fully-paid (non-charge) sales are settled at the terminal, so record the
      // full amount as paid. Charges start at 0 paid (settled later / via credit).
      const initialPaid = isCharge ? 0 : totalDue;

      const insertInvoiceSql = `
        INSERT INTO sales_invoices (
          id, reference, receipt_number, customer_id, invoice_date, due_date, total, amount_paid, payment_method,
          status, transaction_source, notes, is_training, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURDATE(), ${dueDateQuery}, ?, ?, ?, ?, 'POS', ?, ?, NOW(), NOW())
      `;
      await connection.query(insertInvoiceSql, [
        invoiceId,
        sequentialRef,
        receiptNo,
        (customer && customer.id !== 'walk-in') ? customer.id : null,
        totalDue,
        initialPaid,
        paymentMethod,
        invoiceStatus,
        notes || 'POS Sale',
        isTrainingMode
      ]);

      // 3a. Auto-apply any available account credit against a new charge (utang).
      // Reduces the new invoice's outstanding balance and the customer's stored credit.
      let creditApplied = 0;
      if (isCharge && customer && customer.id !== 'walk-in') {
        const [credRows]: any = await connection.query(
          'SELECT COALESCE(credit_balance, 0) AS credit_balance FROM customers WHERE id = ? FOR UPDATE',
          [customer.id]
        );
        const available = credRows && credRows.length > 0 ? parseFloat(credRows[0].credit_balance) || 0 : 0;
        creditApplied = Math.min(available, totalDue);

        if (creditApplied > 0) {
          const creditCoversAll = creditApplied >= totalDue;
          const newStatus = creditCoversAll ? 'Paid' : 'Pending';

          await connection.query(
            'UPDATE sales_invoices SET amount_paid = COALESCE(amount_paid, 0) + ?, status = ?, updated_at = NOW() WHERE id = ?',
            [creditApplied, newStatus, invoiceId]
          );
          await connection.query(
            'UPDATE sales_transactions SET status = ?, updated_at = NOW() WHERE id = ?',
            [newStatus, saleId]
          );
          await connection.query(
            'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) - ?, updated_at = NOW() WHERE id = ?',
            [creditApplied, customer.id]
          );
        }
      }

      // 4. Insert into pos_transactions with payment details reference
      const insertPosTransSql = `
        INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, si_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, payment_details_id, payment_validated_at,
          notes, is_training, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW(), NOW())
      `;

      const posNotes = `Tendered: ₱${(body.amountTendered || totalDue).toFixed(2)}, Change: ₱${(body.change || 0).toFixed(2)}${notes ? ' - ' + notes : ''}`;

      await connection.query(insertPosTransSql, [
        posTransId,
        saleId,
        shiftId || null,
        userId,
        terminalId || null,
        siNumber,
        body.subtotal || totalDue,
        body.taxAmount || 0,
        body.discountAmount || 0,
        totalDue,
        paymentMethod,
        posPaymentStatus,
        paymentDetailsId,
        posNotes,
        isTrainingMode
      ]);

      // 5. Insert items into sales_invoice_items and pos_transaction_items —
      //    one multi-row INSERT per table instead of two round trips per item.
      const invoiceItemRows: any[] = [];
      const posItemRows: any[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = `${saleId}-ITEM-${i + 1}`;
        const invoiceItemId = `${invoiceId}-ITEM-${i + 1}`;
        const posItemId = `${posTransId}-DETAIL-${i + 1}`;

        invoiceItemRows.push([
          invoiceItemId, invoiceId, item.id, item.name, item.quantity,
          item.price * (1 - (item.discount || 0) / 100)
        ]);

        const originalPrice = item.price;
        const discountPercent = item.discount || 0;
        const discAmount = (originalPrice * item.quantity) * (discountPercent / 100);
        const lTotal = (originalPrice * item.quantity) - discAmount;

        const effectiveTaxType = resolveEffectiveTaxType(item.taxType || 'VAT', item.discountType, discountPercent);

        posItemRows.push([
          posItemId, posTransId, itemId, item.id, item.name,
          item.quantity, originalPrice, discountPercent, discAmount,
          item.discountType || 'percent',
          item.discountIdNumber || null,
          item.discountHolderName || null,
          effectiveTaxType,
          lTotal
        ]);
      }

      await connection.query(`
        INSERT INTO sales_invoice_items (
          id, sales_invoice_id, product_id, product_name, quantity, price, created_at
        ) VALUES ${invoiceItemRows.map(() => '(?, ?, ?, ?, ?, ?, NOW())').join(', ')}
      `, invoiceItemRows.flat());

      await connection.query(`
        INSERT INTO pos_transaction_items (
          id, pos_transaction_id, sale_item_id, product_id, product_name,
          quantity, unit_price, discount_percentage, discount_amount,
          discount_type, discount_id_number, discount_holder_name, tax_type, line_total, created_at
        ) VALUES ${posItemRows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())').join(', ')}
      `, posItemRows.flat());

      // 6. Insert payment details
      const pointsUsedValue = paymentDetails?.pointsUsed ? parseFloat(paymentDetails.pointsUsed) : 0;
      const allPayments = body.payments ? [...body.payments] : [];

      if (allPayments.length === 0) {
          // Fallback if no payments array (e.g. 100% points or legacy)
          await connection.query(`
            INSERT INTO payment_details (
              id, transaction_id, payment_method,
              card_type, card_last_four, auth_code, gateway_reference,
              wallet_provider, wallet_reference,
              gift_check_number, gift_check_balance_before, gift_check_balance_after,
              points_used, points_remaining, points_conversion_rate,
              amount_tendered, change_given, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          `, [
            paymentDetailsId,
            posTransId,
            paymentMethod,
            paymentDetails?.cardType || null,
            paymentDetails?.cardLastFour || null,
            paymentDetails?.authCode || null,
            paymentDetails?.gatewayReference || null,
            paymentDetails?.walletProvider || null,
            paymentDetails?.walletReference || null,
            paymentDetails?.giftCheckNumber || null,
            paymentDetails?.giftCheckBalanceBefore || null,
            paymentDetails?.giftCheckBalanceAfter || null,
            paymentDetails?.pointsUsed || null,
            paymentDetails?.pointsRemaining || null,
            paymentDetails?.pointsConversionRate || null,
            amountTendered || totalDue,
            change || 0,
            paymentDetails?.notes || null
          ]);
      } else {
          for (let i = 0; i < allPayments.length; i++) {
              const p = allPayments[i];
              const detailId = i === 0 ? paymentDetailsId : `PD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
              
              // Attach points info to the first row only
              const pUsed = i === 0 ? paymentDetails?.pointsUsed || null : null;
              const pRem = i === 0 ? paymentDetails?.pointsRemaining || null : null;
              const pRate = i === 0 ? paymentDetails?.pointsConversionRate || null : null;
              const cGiven = i === allPayments.length - 1 ? (change || 0) : 0; // change on last row

              await connection.query(`
                INSERT INTO payment_details (
                  id, transaction_id, payment_method, gateway_reference, points_used, points_remaining, points_conversion_rate, amount_tendered, change_given, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
              `, [
                detailId, posTransId, p.method, p.reference || null,
                pUsed, pRem, pRate, p.amount, cGiven
              ]);
          }
      }

      // 6.5 Record in customer_payments if customer exists
      if (customer && customer.id !== 'walk-in') {
          const insertCustomerPayment = async (method: string, amt: number, ref: string, note: string) => {
              const cPaymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              await connection.query(`
                INSERT INTO customer_payments (
                  id, customer_id, payment_type, payment_date, amount, reference, note, created_at, updated_at
                ) VALUES (?, ?, ?, CURDATE(), ?, ?, ?, NOW(), NOW())
              `, [cPaymentId, customer.id, method, amt, ref, note]);
          };

          if (allPayments.length > 0) {
               for (const p of allPayments) {
                   const isChg = typeof p.method === 'string' && p.method.toUpperCase() === 'CHARGE';
                   await insertCustomerPayment(p.method, p.amount, sequentialRef, `POS Sale - ${isChg ? 'Charged to Account' : 'Paid at POS'}`);
               }
          } else {
               await insertCustomerPayment(paymentMethod, totalDue, sequentialRef, `POS Sale - ${isCharge ? 'Charged to Account' : 'Paid at POS'}`);
          }
      }

      // 7. Loyalty Points Redemption
      if (customer && customer.id !== 'walk-in' && pointsUsedValue > 0) {
          const pointsToDeduct = pointsUsedValue;
          
          // Verify balance again & get loyalty ID
          const [custRows]: any = await connection.query(
             'SELECT id, current_points FROM customer_loyalty WHERE customer_id = ? LIMIT 1', 
             [customer.id]
          );
          
          let loyaltyId;
          let currentPoints = 0;

          if (!custRows || custRows.length === 0) {
              loyaltyId = `LOY-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
              
              // Fetch legacy points if the loyalty record doesn't exist yet
              const [legacyRows]: any = await connection.query(
                  'SELECT loyalty_points FROM customers WHERE id = ?', [customer.id]
              );
              currentPoints = legacyRows && legacyRows.length > 0 ? parseFloat(legacyRows[0].loyalty_points) || 0 : 0;
              
              if (currentPoints < pointsToDeduct) {
                 throw new Error(`Insufficient points. Available: ${currentPoints}, Required: ${pointsToDeduct}`);
              }
              
              // Create the missing loyalty record initialized with their legacy points
              await connection.query(
                  'INSERT INTO customer_loyalty (id, customer_id, current_points, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
                  [loyaltyId, customer.id, currentPoints]
              );
          } else {
              loyaltyId = custRows[0].id;
              currentPoints = parseFloat(custRows[0].current_points) || 0;
              
              if (currentPoints < pointsToDeduct) {
                 throw new Error(`Insufficient points. Available: ${currentPoints}, Required: ${pointsToDeduct}`);
              }
          }
          
          // Deduct
          await connection.query(
             'UPDATE customer_loyalty SET current_points = current_points - ? WHERE id = ?',
             [pointsToDeduct, loyaltyId]
          );
          
          // Log History (Redemption)
          const historyId = `PH-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          await connection.query(
             'INSERT INTO point_history (id, customer_loyalty_id, transaction_type, points, reason, transaction_reference, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
             [historyId, loyaltyId, 'redemption', pointsToDeduct, 'Point Redemption at POS', posTransId]
          );
      }

      // 8. Loyalty Points Awarding - ONLY if no points were redeemed
      let totalPointsEarned = 0;
      if (
        loyaltySettings && 
        loyaltySettings.length > 0 && 
        customer && 
        customer.id !== 'walk-in' &&
        pointsUsedValue === 0 // Skip if points were redeemed
      ) {
          // Adjust eligible amount
          const finalEligibleAmount = eligiblePointsAmount;
          
          if (finalEligibleAmount > 0) {
              const settings = loyaltySettings[0];
          // Calculate points: (Eligible Amount / Amount Threshold) * Equivalent Points
          // Defaulting to 0 if settings are missing to avoid NaN
          const threshold = parseFloat(settings.amount) || 0;
          const equivalent = parseFloat(settings.equivalent) || 0;
          
          console.log('Loyalty Debug:', { eligiblePointsAmount, threshold, equivalent, settings });

          if (threshold > 0 && equivalent > 0) {
              const pointsEarned = Math.floor(finalEligibleAmount / threshold) * equivalent;
              console.log('Points Earned Calculated:', pointsEarned, 'on basis:', finalEligibleAmount);

              if (pointsEarned > 0) {
                  totalPointsEarned = pointsEarned;
                  // Check for existing loyalty record
                  const [loyaltyRecord]: any = await connection.query(
                      'SELECT id, current_points FROM customer_loyalty WHERE customer_id = ? LIMIT 1',
                      [customer.id]
                  );

                  let loyaltyId = '';
                  let previousPoints = 0;

                  if (loyaltyRecord && loyaltyRecord.length > 0) {
                       loyaltyId = loyaltyRecord[0].id;
                       previousPoints = loyaltyRecord[0].current_points;
                       
                       // Update existing
                       await connection.query(
                           'UPDATE customer_loyalty SET current_points = current_points + ?, updated_at = NOW() WHERE id = ?',
                           [pointsEarned, loyaltyId]
                       );
                  } else {
                       // Create new
                       loyaltyId = `LOY-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                       await connection.query(
                           'INSERT INTO customer_loyalty (id, customer_id, current_points, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
                           [loyaltyId, customer.id, pointsEarned]
                       );
                  }

                  // Record history
                  const historyId = `PH-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                  await connection.query(`
                      INSERT INTO point_history (
                          id, customer_loyalty_id, transaction_type, points, 
                          reason, transaction_reference, created_at
                      ) VALUES (?, ?, 'purchase', ?, ?, ?, NOW())
                  `, [
                      historyId,
                      loyaltyId,
                      pointsEarned,
                      `Earned from Sale ${saleId}`,
                      saleId
                  ]);
                  
                  // Log debug
                  console.log(`Awarded ${pointsEarned} points to customer ${customer.id} for sale ${saleId}`);
              }
          }
      }
  }

      // 8. Log successful payment
      await connection.query(`
        INSERT INTO payment_audit_log (
          id, transaction_id, payment_method, action, status, amount, 
          details, user_id, created_at
        ) VALUES (?, ?, ?, 'processed', 'success', ?, ?, ?, NOW())
      `, [
        `PAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        posTransId,
        paymentMethod,
        totalDue,
        JSON.stringify({ saleId, invoiceId, paymentDetailsId }),
        userId
      ]);

      // Fetch the auto-generated order number
      const [orderResult]: any = await connection.query('SELECT order_number FROM pos_transactions WHERE id = ?', [posTransId]);
      const orderNumber = orderResult[0]?.order_number;

      let pointsRemaining = 0;
      if (customer && customer.id !== 'walk-in') {
        const [updatedLoyalty]: any = await connection.query(
          'SELECT current_points FROM customer_loyalty WHERE customer_id = ? LIMIT 1',
          [customer.id]
        );
        pointsRemaining = updatedLoyalty && updatedLoyalty.length > 0 ? updatedLoyalty[0].current_points : 0;
      }

      return NextResponse.json({
        success: true,
        data: { saleId, posTransId, invoiceId, paymentDetailsId, orderNumber, siNumber, pointsEarned: totalPointsEarned, pointsRemaining, creditApplied },
        message: 'Transaction saved successfully'
      });
    });

  } catch (error: any) {
    console.error('Error during checkout:', error);
    
    // Log failed payment attempt
    try {
      const { query } = await import('@/lib/mysql');
      await query(`
        INSERT INTO payment_audit_log (
          id, transaction_id, payment_method, action, status, amount, 
          error_message, user_id, created_at
        ) VALUES (?, ?, ?, 'processed', 'failed', ?, ?, ?, NOW())
      `, [
        `PAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        'unknown',
        'unknown',
        0,
        error.message,
        'unknown'
      ]);
    } catch (logError) {
      console.error('Failed to log payment error:', logError);
    }
    
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
