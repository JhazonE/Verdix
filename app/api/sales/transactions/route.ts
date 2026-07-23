import { NextRequest, NextResponse } from 'next/server';
// Force rebuild: Fixed import path
import { query, withTransaction, getNextReference, getNextReceiptNumber } from '@/lib/mysql';
import { deductFromBatches, getBatchCostingSettings } from '@/lib/batch-deduction';
import { isService } from '@/lib/product-type';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate'); // yyyy-MM-dd
    const endDate = searchParams.get('endDate');     // yyyy-MM-dd
    const terminalId = searchParams.get('terminalId');
    const productId = searchParams.get('productId'); // Filter by product content
    const status = searchParams.get('status');       // 'Paid', 'Void', 'Returned'
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    let baseSql = `
      SELECT
        pt.id as pos_transaction_id,
        pt.sale_id,
        pt.order_number,
        pt.si_number,
        pt.mc_number,
        pt.transaction_type,
        pt.subtotal,
        pt.discount_amount,
        pt.tax_amount,
        pt.total_amount,
        pt.payment_method,
        pt.transaction_time,
        pt.void_reason,
        pt.notes,
        pt.payment_status,
        pt.user_id,
        u.display_name as cashier_name,
        pt.terminal_id,
        term.name as terminal_name,
        st.customer_id,
        st.reference,
        st.receipt_number,
        st.si_number as sales_trans_si_number,
        st.transaction_source,
        c.name as customer_name,
        c.contact_number as customer_contact,
        st.status as sale_status,
        orig_pt.order_number as original_order_number,
        orig_pt.si_number as original_si_number,
        orig_pt.transaction_time as original_transaction_time,
        orig_u.display_name as original_cashier_name,
        pd.gateway_reference as payment_reference
      FROM pos_transactions pt
      LEFT JOIN users u ON pt.user_id = u.uid
      LEFT JOIN pos_terminals term ON pt.terminal_id = term.id
      LEFT JOIN sales_transactions st ON pt.sale_id = st.id
      LEFT JOIN customers c ON st.customer_id = c.id
      LEFT JOIN pos_transactions orig_pt ON (pt.transaction_type = 'return' AND pt.sale_id = orig_pt.sale_id AND orig_pt.transaction_type = 'sale')
      LEFT JOIN users orig_u ON orig_pt.user_id = orig_u.uid
      LEFT JOIN payment_details pd ON pt.payment_details_id = pd.id
      WHERE 1=1
    `;

    const params: any[] = [];
    let whereClause = '';

    if (productId) {
      // If filtering by product, we need to join with pos_transaction_items to check existence
      whereClause += ` AND EXISTS (SELECT 1 FROM pos_transaction_items pti WHERE pti.pos_transaction_id = pt.id AND pti.product_id = ?)`;
      params.push(productId);
    }

    if (startDate) {
      whereClause += ' AND DATE(pt.transaction_time) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND DATE(pt.transaction_time) <= ?';
      params.push(endDate);
    }
    if (terminalId && terminalId !== 'all') {
      whereClause += ' AND pt.terminal_id = ?';
      params.push(terminalId);
    }
    
    // Status filter: tricky because pos_transactions has 'transaction_type' (sale, void, return)
    // while sales_transactions has 'status' (Paid, Returned, Void).
    // If user asks for 'Void', we look for transaction_type = 'void' OR sale_status = 'Void'
    if (status) {
      if (status === 'Voided') {
         whereClause += " AND (pt.transaction_type = 'void' OR st.status = 'Voided')";
      } else if (status === 'Returned') {
         whereClause += " AND (pt.transaction_type = 'return' OR st.status = 'Returned')";
      } else if (status === 'Paid') {
         whereClause += " AND (pt.transaction_type = 'sale' AND st.status = 'Paid')";
      } else {
         whereClause += ' AND st.status = ?';
         params.push(status);
      }
    }

    // 1. Get total count
    const countSql = `SELECT COUNT(*) as total FROM pos_transactions pt 
                      LEFT JOIN sales_transactions st ON pt.sale_id = st.id 
                      WHERE 1=1 ${whereClause}`;
    // Re-use params for count query, but we need to ensure joint tables are available if referenced in whereClause
    // The simplified count query above assumes we only need joins if they are used in filtering.
    // However, the WHERE clause uses 'st' alias, so we must include the JOINs in the count query too.
    const fullCountSql = `
      SELECT COUNT(*) as total
      FROM pos_transactions pt
      LEFT JOIN users u ON pt.user_id = u.uid
      LEFT JOIN pos_terminals term ON pt.terminal_id = term.id
      LEFT JOIN sales_transactions st ON pt.sale_id = st.id
      LEFT JOIN customers c ON st.customer_id = c.id
      WHERE 1=1 ${whereClause}
    `;

    const countResult = await query(fullCountSql, params);
    const totalRecords = countResult[0]?.total || 0;
    const totalPages = Math.ceil(totalRecords / limit);

    // 2. Get paginated data
    const dataSql = baseSql + whereClause + ' ORDER BY pt.transaction_time DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const transactions = await query(dataSql, params);
    
    // Fetch items for these transactions
    let transactionItems: any[] = [];
    if (transactions.length > 0) {
        const transactionIds = transactions.map((t: any) => t.pos_transaction_id);
        const placeholders = transactionIds.map(() => '?').join(',');
        
        const itemsSql = `
            SELECT 
                pti.id,
                pti.pos_transaction_id,
                pti.product_id,
                pti.product_name,
                pti.quantity,
                pti.unit_price,
                pti.line_total,
                pti.discount_percentage,
                pti.discount_amount,
                COALESCE(p.cost, 0) as product_cost,
                p.description,
                p.unit_of_measure
            FROM pos_transaction_items pti
            LEFT JOIN products p ON pti.product_id = p.id
            WHERE pti.pos_transaction_id IN (${placeholders})
        `;
        
        transactionItems = await query(itemsSql, transactionIds);
    }

    // Group items by transaction ID
    const itemsByTransaction: Record<string, any[]> = {};
    transactionItems.forEach((item: any) => {
        if (!itemsByTransaction[item.pos_transaction_id]) {
            itemsByTransaction[item.pos_transaction_id] = [];
        }
        itemsByTransaction[item.pos_transaction_id].push({
            id: item.id,
            productId: item.product_id,
            productName: item.product_name,
            description: item.description, // Added description
            quantity: item.quantity,
            price: parseFloat(item.unit_price) || 0,
            total: parseFloat(item.line_total) || 0,
            cost: parseFloat(item.product_cost) || 0,
            discount: parseFloat(item.discount_amount) || 0,
            unitOfMeasure: item.unit_of_measure
        });
    });
    
    // Transform logic if needed
    const data = transactions.map((row: any) => {
      const totalAmount = parseFloat(row.total_amount) || 0;
      const taxAmount = parseFloat(row.tax_amount) || 0;
      const discountAmount = parseFloat(row.discount_amount) || 0;
      const subtotal = parseFloat(row.subtotal) || totalAmount;
      
      // Get items for this transaction
      const items = itemsByTransaction[row.pos_transaction_id] || [];
      
      // Calculate total cost and profit based on items
      const calculatedCost = items.reduce((sum: number, item: any) => sum + (item.cost * item.quantity), 0);
      const calculatedProfit = totalAmount - calculatedCost - taxAmount; // Profit = Revenue - Cost - Tax

      // Calculate vatable sales (total minus VAT)
      const vatableSales = totalAmount - taxAmount;
      // For now, non-vat sales is 0 (all sales are VAT-inclusive)
      const nonVatSales = 0;
      
      const balance = 0;
      const amountPaid = totalAmount; // Assuming full payment for now as logic for partial isn't fully clear

      // SI No. with fallback to legacy fields
      const siNumber = row.si_number || row.sales_trans_si_number || row.receipt_number || row.order_number;

      return {
        id: row.sale_id,
        reference: row.reference,
        transactionSource: row.transaction_source || 'POS',
        siNumber: siNumber, // Primary field: SI Number (consolidated)
        // Merchandise Credit number — only set on returns issued after MC
        // numbering was added. NULL on historical returns (see migration 099).
        mcNumber: row.mc_number || null,
        orderNumber: row.order_number, // Legacy field (kept for 90 days)
        receiptNo: row.receipt_number, // Legacy field (kept for 90 days)
        posTransactionId: row.pos_transaction_id,
        date: row.transaction_time,
        total: totalAmount,
        subtotal: subtotal,
        discount: discountAmount,
        taxAmount: taxAmount,
        vatableSales: vatableSales,
        nonVatSales: nonVatSales,
        amountPaid: amountPaid,
        balance: balance,
        cost: calculatedCost,
        profit: calculatedProfit,
        notes: row.notes || '',
        paymentStatus: row.payment_status || 'completed',
        status: row.sale_status || (row.transaction_type === 'sale' ? 'Paid' : row.transaction_type === 'return' ? 'Returned' : 'Voided'),
        transactionType: row.transaction_type,
        paymentMethod: row.payment_method,
        paymentReference: row.payment_reference,
        customer: {
          id: row.customer_id,
          name: row.customer_name || 'Walk-in Customer',
          contactNumber: row.customer_contact
        },
        cashier: row.cashier_name || 'N/A',
        terminal: row.terminal_name || 'N/A',
        items: items, // Attach items
        // Original sale information (for returns)
        // Prefer the original sale's real SI number; fall back to sales_transactions
        // SI, then legacy order_number, so the credit report matches the receipt.
        originalSINumber: row.original_si_number || row.sales_trans_si_number || row.original_order_number || null,
        originalOrderNumber: row.original_order_number || null,
        originalTransactionTime: row.original_transaction_time || null,
        originalCashierName: row.original_cashier_name || null
      };
    });

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages
      }
    });

  } catch (error) {
    console.error('Error fetching POS transactions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
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
      amountTendered,
      change
    } = body;

    // Validation
    if (!items || items.length === 0) {
      return NextResponse.json({ success: false, error: 'No items in transaction' }, { status: 400 });
    }

    // Default User ID if not provided (safety check, though API users should provide it)
    const finalUserId = userId || 'api_user'; 

    // Generate IDs
    const saleId = `SALE-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const posTransId = `PT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const paymentDetailsId = `PD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const auditLogId = `PAL-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    return await withTransaction(async (connection) => {
      // 1. Log payment initiation
      await connection.query(`
        INSERT INTO payment_audit_log (
          id, transaction_id, payment_method, action, status, amount, user_id, created_at
        ) VALUES (?, ?, ?, 'initiated', 'pending', ?, ?, NOW())
      `, [auditLogId, posTransId, paymentMethod, totalDue, finalUserId]);

      // Generate sequential reference (INV-XXXXXX)
      const nextRefVal = await getNextReference('sales_invoice');
      const sequentialRef = `INV-${nextRefVal.toString().padStart(6, '0')}`;
      
      // Get terminal specific receipt (OR)
      const receiptNo = await getNextReceiptNumber(terminalId);

      // 2. Insert into sales_transactions
      const insertSaleSql = `
        INSERT INTO sales_transactions (
          id, reference, receipt_number, customer_id, invoice_date, date, total, payment_method, status, transaction_source, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURDATE(), CURDATE(), ?, ?, 'Paid', 'POS', ?, NOW(), NOW())
      `;
      await connection.query(insertSaleSql, [
        saleId,
        sequentialRef,
        receiptNo,
        (customer && customer.id !== 'walk-in') ? customer.id : null,
        totalDue,
        paymentMethod,
        notes || 'API Sale'
      ]);

      // 3. Insert into sale_items and update stock
      const { oversellBlock } = await getBatchCostingSettings(connection);

      const insertItemSql = `
        INSERT INTO sale_items (
          id, sale_id, product_id, product_name, quantity, price, cost_at_sale, batch_source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemId = `${saleId}-ITEM-${i + 1}`;

        const [prodRows]: any = await connection.query(
          'SELECT id, type, cost FROM products WHERE id = ?',
          [item.id]
        );
        const prod = prodRows?.[0];
        const itemIsService = prod ? isService(prod) : false;

        // --- BATCH COSTING: FIFO Deduction ---
        // Services have no batches; cost comes from the product's fixed cost.
        let deduction: { weightedAvgCost: number; splits: any[] };
        if (itemIsService) {
          deduction = {
            weightedAvgCost: prod?.cost != null ? parseFloat(prod.cost) : 0,
            splits: [],
          };
        } else {
          deduction = await deductFromBatches(item.id, item.quantity, oversellBlock, connection);
        }

        await connection.query(insertItemSql, [
          itemId,
          saleId,
          item.id,
          item.name,
          item.quantity,
          item.price,
          deduction.weightedAvgCost,
          JSON.stringify(deduction.splits)
        ]);
        // --- END BATCH COSTING ---

        // Stock Deduction Logic (Simplified for API - assumes standard product flow)
        // Note: Full family sync logic from checkout is omitted for brevity unless critical.
        // If critical, we should extract to a shared library.
        // For now, doing direct stock update for the specific product to ensure basic correctness.
        // Services carry no stock — nothing to deduct or log a movement for.
        if (!itemIsService) {
          // Fetch current stock
          const [prodResult]: any = await connection.query('SELECT stock FROM products WHERE id = ?', [item.id]);
          if (prodResult && prodResult.length > 0) {
              const currentStock = Number(prodResult[0].stock || 0);
              const newStock = currentStock - item.quantity;

              // Record movement
              const movementId = `MOV-${Date.now()}-${i}-${item.id.substring(Math.max(0, item.id.length - 4))}`;
              await connection.query(`
                  INSERT INTO stock_movements (
                      id, product_id, product_name, movement_type,
                      quantity_change, previous_stock, new_stock,
                      reference_id, reference_type, notes, created_at, updated_at
                  ) VALUES (?, ?, ?, 'sale', ?, ?, ?, ?, 'sale', ?, NOW(), NOW())
              `, [movementId, item.id, item.name, -item.quantity, currentStock, newStock, saleId, 'API Sale']);

              // Update product
              await connection.query('UPDATE products SET stock = ? WHERE id = ?', [newStock, item.id]);
          }
        }
      }

      // 4. Insert into sales_invoices (Legacy/Reporting Sync)
      const invoiceId = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      

      await connection.query(`
        INSERT INTO sales_invoices (
          id, reference, receipt_number, customer_id, invoice_date, due_date, total, payment_method,
          status, transaction_source, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, CURDATE(), CURDATE(), ?, ?, 'Paid', 'POS', ?, NOW(), NOW())
      `, [
        invoiceId,
        sequentialRef,
        receiptNo,
        (customer && customer.id !== 'walk-in') ? customer.id : null,
        totalDue,
        paymentMethod,
        notes || 'API Sale'
      ]);

      // 5. Insert into pos_transactions
      const insertPosTransSql = `
        INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type,
          subtotal, tax_amount, discount_amount, total_amount, payment_method, 
          payment_status, payment_details_id, payment_validated_at,
          notes, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, 'completed', ?, NOW(), ?, NOW(), NOW(), NOW())
      `;
      
      const posNotes = `API Transaction. Tendered: ${amountTendered || totalDue}`;
      
      await connection.query(insertPosTransSql, [
        posTransId,
        saleId,
        shiftId || null,
        finalUserId,
        terminalId || null,
        totalDue, // assuming subtotal = total for simple API calls
        0, // tax placeholder
        0, // discount placeholder
        totalDue,
        paymentMethod,
        paymentDetailsId,
        posNotes
      ]);

      // 6. Insert items into sales_invoice_items and pos_transaction_items
       for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const invoiceItemId = `${invoiceId}-ITEM-${i + 1}`;
        const posItemId = `${posTransId}-DETAIL-${i + 1}`;
        const saleItemId = `${saleId}-ITEM-${i + 1}`; // Match ID generated above logic

        // Sales Invoice Items
        await connection.query(`
          INSERT INTO sales_invoice_items (
            id, sales_invoice_id, product_id, product_name, quantity, price, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [invoiceItemId, invoiceId, item.id, item.name, item.quantity, item.price]);

        // POS Transaction Items
        await connection.query(`
          INSERT INTO pos_transaction_items (
            id, pos_transaction_id, sale_item_id, product_id, product_name, 
            quantity, unit_price, line_total, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          posItemId, 
          posTransId, 
          saleItemId, 
          item.id, 
          item.name, 
          item.quantity, 
          item.price, 
          item.quantity * item.price
        ]);
      }

      // Fetch order number
      const [orderResult]: any = await connection.query('SELECT order_number FROM pos_transactions WHERE id = ?', [posTransId]);
      const orderNumber = orderResult[0]?.order_number;

      return NextResponse.json({
        success: true,
        data: { saleId, posTransId, orderNumber },
        message: 'Transaction created successfully via API'
      });
    });

  } catch (error: any) {
    console.error('Error creating sales transaction:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create transaction' },
      { status: 500 }
    );
  }
}

