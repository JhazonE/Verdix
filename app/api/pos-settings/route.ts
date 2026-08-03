import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../lib/mysql';

// GET endpoint to fetch POS settings
export async function GET(request: NextRequest) {
  try {
    // Ensure new columns exist by checking metadata directly
    const columns = [
      { name: 'operated_by', type: 'VARCHAR(255) NULL' },
      { name: 'min_number', type: 'VARCHAR(100) NULL' },
      { name: 'serial_number', type: 'VARCHAR(100) NULL' },
      { name: 'low_stock_threshold', type: 'INT DEFAULT 10' },
      { name: 'enable_email_notifications', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'notification_email', type: 'VARCHAR(255) NULL' },
      { name: 'enable_push_notifications', type: 'BOOLEAN DEFAULT TRUE' },
      { name: 'is_training_mode', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'enable_tax_rates_auth', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'tax_rates_auth_username', type: 'VARCHAR(255) NULL' },
      { name: 'tax_rates_auth_password', type: 'VARCHAR(255) NULL' },
      { name: 'fiscal_year_start_month', type: 'INT DEFAULT 1' },
      { name: 'print_two_receipts', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'native_printer_name', type: 'VARCHAR(255) DEFAULT "XP-58-P"' },
      { name: 'require_adjustment_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_transfer_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_po_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_receive_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_bad_order_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_stock_count_approval', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_repackaging_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_shelf_transfer_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_product_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'require_price_update_confirmation', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'batch_costing_repack_inherit', type: 'TINYINT(1) DEFAULT 1' },
      { name: 'batch_costing_oversell_block', type: 'TINYINT(1) DEFAULT 0' },
      { name: 'enable_overall_reading_auth', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'overall_reading_auth_username', type: 'VARCHAR(255) NULL' },
      { name: 'overall_reading_auth_password', type: 'VARCHAR(255) NULL' },
      { name: 'enable_customer_display', type: 'TINYINT(1) DEFAULT 0' },
      { name: 'customer_display_message', type: "VARCHAR(255) DEFAULT 'Welcome! Thank you for shopping.'" },
      { name: 'customer_display_show_logo', type: 'TINYINT(1) DEFAULT 1' },
      { name: 'vat_registration', type: "VARCHAR(20) DEFAULT 'VAT'" },
      { name: 'sales_order_terms', type: 'TEXT NULL' },
      { name: 'enable_cash_transfer_auth', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'cash_transfer_auth_username', type: 'VARCHAR(255) NULL' },
      { name: 'cash_transfer_auth_password', type: 'VARCHAR(255) NULL' },
      { name: 'pos_mode', type: "ENUM('default','pharmacy') DEFAULT 'default'" },
      { name: 'enable_edit_item_auth', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'edit_item_auth_username', type: 'VARCHAR(255) NULL' },
      { name: 'edit_item_auth_password', type: 'VARCHAR(255) NULL' },
      { name: 'enable_suspend_auth', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'suspend_auth_username', type: 'VARCHAR(255) NULL' },
      { name: 'suspend_auth_password', type: 'VARCHAR(255) NULL' },
      { name: 'enable_suspended_auth', type: 'BOOLEAN DEFAULT FALSE' },
      { name: 'suspended_auth_username', type: 'VARCHAR(255) NULL' },
      { name: 'suspended_auth_password', type: 'VARCHAR(255) NULL' },
      { name: 'membership_fee', type: 'DECIMAL(10,2) NOT NULL DEFAULT 0.00' },
      { name: 'membership_duration_months', type: 'INT NOT NULL DEFAULT 12' }
    ];

    const currentColumnsResult = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_settings' AND TABLE_SCHEMA = DATABASE()"
    );
    const existingColumns = new Set(currentColumnsResult.map((c: any) => c.COLUMN_NAME));

    for (const col of columns) {
      if (!existingColumns.has(col.name)) {
        try {
          await query(`ALTER TABLE pos_settings ADD COLUMN ${col.name} ${col.type}`);
        } catch (e) {
          // Ignored
        }
      }
    }

    const sql = `
      SELECT
        id,
        business_name AS businessName,
        logo_path AS logoPath,
        transaction_prefix AS transactionPrefix,
        currency_symbol AS currencySymbol,
        currency_code AS currencyCode,
        timezone,
        date_format AS dateFormat,
        enable_automatic_markup AS enableAutomaticMarkup,
        default_markup_percentage AS defaultMarkupPercentage,
        markup_priority AS markupPriority,
        address,
        contact_number AS contactNumber,
        tin,
        email,
        created_at AS createdAt,
        updated_at AS updatedAt,
        enable_line_void_auth AS enableLineVoidAuth,
        line_void_auth_username AS lineVoidAuthUsername,
        line_void_auth_password AS lineVoidAuthPassword,
        enable_void_return_auth AS enableVoidReturnAuth,
        void_auth_username AS voidAuthUsername,
        void_auth_password AS voidAuthPassword,
        enable_return_auth AS enableReturnAuth,
        return_auth_username AS returnAuthUsername,
        return_auth_password AS returnAuthPassword,
        enable_recent_sales_auth AS enableRecentSalesAuth,
        recent_sales_auth_username AS recentSalesAuthUsername,
        recent_sales_auth_password AS recentSalesAuthPassword,
        paper_size AS paperSize,
        print_mode AS printMode,
        enable_negative_inventory AS enableNegativeInventory,
        enable_cash_count_auth AS enableCashCountAuth,
        cash_count_auth_username AS cashCountAuthUsername,
        cash_count_auth_password AS cashCountAuthPassword,
        show_quantity_in_search AS showQuantityInSearch,
        enable_price_edit_auth AS enablePriceEditAuth,
        price_edit_auth_username AS priceEditAuthUsername,
        price_edit_auth_password AS priceEditAuthPassword,
        enable_edit_item_auth AS enableEditItemAuth,
        edit_item_auth_username AS editItemAuthUsername,
        edit_item_auth_password AS editItemAuthPassword,
        enable_suspend_auth AS enableSuspendAuth,
        suspend_auth_username AS suspendAuthUsername,
        suspend_auth_password AS suspendAuthPassword,
        enable_suspended_auth AS enableSuspendedAuth,
        suspended_auth_username AS suspendedAuthUsername,
        suspended_auth_password AS suspendedAuthPassword,
        operated_by AS operatedBy,
        min_number AS minNumber,
        serial_number AS serialNumber,
        low_stock_threshold AS lowStockThreshold,
        enable_email_notifications AS enableEmailNotifications,
        notification_email AS notificationEmail,
        enable_push_notifications AS enablePushNotifications,
        is_training_mode AS isTrainingMode,
        enable_tax_rates_auth AS enableTaxRatesAuth,
        tax_rates_auth_username AS taxRatesAuthUsername,
        tax_rates_auth_password AS taxRatesAuthPassword,
        fiscal_year_start_month AS fiscalYearStartMonth,
        print_two_receipts AS printTwoReceipts,
        native_printer_name AS nativePrinterName,
        require_adjustment_confirmation AS requireAdjustmentConfirmation,
        require_transfer_confirmation AS requireTransferConfirmation,
        require_po_confirmation AS requirePurchaseOrderConfirmation,
        require_receive_confirmation AS requireReceiveConfirmation,
        require_bad_order_confirmation AS requireBadOrderConfirmation,
        require_stock_count_approval AS requireStockCountApproval,
        require_repackaging_confirmation AS requireRepackagingConfirmation,
        require_shelf_transfer_confirmation AS requireShelfTransferApproval,
        require_product_confirmation AS requireProductConfirmation,
        require_price_update_confirmation AS requirePriceUpdateConfirmation,
        batch_costing_repack_inherit AS batchCostingRepackInherit,
        batch_costing_oversell_block AS batchCostingOversellBlock,
        enable_overall_reading_auth AS enableOverallReadingAuth,
        overall_reading_auth_username AS overallReadingAuthUsername,
        overall_reading_auth_password AS overallReadingAuthPassword,
        enable_customer_display AS enableCustomerDisplay,
        customer_display_message AS customerDisplayMessage,
        customer_display_show_logo AS customerDisplayShowLogo,
        vat_registration AS vatRegistration,
        sales_order_terms AS salesOrderTerms,
        enable_cash_transfer_auth AS enableCashTransferAuth,
        cash_transfer_auth_username AS cashTransferAuthUsername,
        cash_transfer_auth_password AS cashTransferAuthPassword,
        pos_mode AS posMode,
        membership_fee AS membershipFee,
        membership_duration_months AS membershipDurationMonths
      FROM pos_settings
      LIMIT 1
    `;
    
    const result = await query(sql);
    
    if (result.length === 0) {
      // Create default settings if none exist
      const insertSQL = `
        INSERT INTO pos_settings (id, business_name, transaction_prefix, currency_symbol, currency_code, timezone, date_format, enable_automatic_markup, default_markup_percentage, markup_priority, show_quantity_in_search)
        VALUES ('pos_settings_1', 'My Business', 'TXN', '$', 'USD', 'UTC', 'MM/DD/YYYY', TRUE, 0.00, '["subcategory", "category", "brand", "supplier"]', TRUE)
      `;
      await query(insertSQL);
      
      // Fetch the newly created settings
      const newResult = await query(sql);
      return NextResponse.json({
        success: true,
        data: newResult[0],
        timestamp: new Date().toISOString()
      });
    }
    
    return NextResponse.json({
      success: true,
      data: result[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching POS settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch POS settings' },
      { status: 500 }
    );
  }
}

// POST/PUT endpoint to update POS settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Check if settings exist
    const checkSQL = 'SELECT id FROM pos_settings LIMIT 1';
    const existing = await query(checkSQL);

    if (existing.length === 0) {
      // Insert new settings (initial setup)
      const { 
        businessName, logoPath, transactionPrefix, 
        address, contactNumber, tin, email,
        currencySymbol, currencyCode, timezone, dateFormat,
        enableAutomaticMarkup, defaultMarkupPercentage, markupPriority,
        enableLineVoidAuth, lineVoidAuthUsername, lineVoidAuthPassword,
        enableVoidReturnAuth, voidAuthUsername, voidAuthPassword,
        enableReturnAuth, returnAuthUsername, returnAuthPassword,
        enableRecentSalesAuth, recentSalesAuthUsername, recentSalesAuthPassword,
        paperSize, printMode,
        enableNegativeInventory,
        enableCashCountAuth, cashCountAuthUsername, cashCountAuthPassword,
        showQuantityInSearch,
        enablePriceEditAuth, priceEditAuthUsername, priceEditAuthPassword,
        operatedBy, minNumber, serialNumber,
        lowStockThreshold, enableEmailNotifications, notificationEmail, enablePushNotifications,
        enableTaxRatesAuth, taxRatesAuthUsername, taxRatesAuthPassword,
        fiscalYearStartMonth, printTwoReceipts, nativePrinterName,
        enableOverallReadingAuth, overallReadingAuthUsername, overallReadingAuthPassword
      } = body;

      const insertSQL = `
        INSERT INTO pos_settings (
          id, business_name, logo_path, transaction_prefix, 
          address, contact_number, tin, email,
          currency_symbol, currency_code, timezone, date_format,
          enable_automatic_markup, default_markup_percentage, markup_priority,
          enable_line_void_auth, line_void_auth_username, line_void_auth_password,
          enable_void_return_auth, void_auth_username, void_auth_password,
          enable_return_auth, return_auth_username, return_auth_password,
          enable_recent_sales_auth, recent_sales_auth_username, recent_sales_auth_password,
          paper_size, print_mode, enable_negative_inventory,
          enable_cash_count_auth, cash_count_auth_username, cash_count_auth_password,
          low_stock_threshold, enable_email_notifications, notification_email, enable_push_notifications,
          enable_tax_rates_auth, tax_rates_auth_username, tax_rates_auth_password,
          fiscal_year_start_month, print_two_receipts, native_printer_name,
          require_adjustment_confirmation, require_transfer_confirmation,
          require_po_confirmation, require_receive_confirmation,
          require_bad_order_confirmation, require_stock_count_approval,
          require_repackaging_confirmation, require_shelf_transfer_confirmation,
          require_product_confirmation,
          require_price_update_confirmation,
          enable_overall_reading_auth, overall_reading_auth_username, overall_reading_auth_password
        )
        VALUES ('pos_settings_1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await query(insertSQL, [
        businessName || 'My Business',
        logoPath || null,
        transactionPrefix || 'TXN',
        address || null,
        contactNumber || null,
        tin || null,
        email || null,
        currencySymbol || '$',
        currencyCode || 'USD',
        timezone || 'UTC',
        dateFormat || 'MM/DD/YYYY',
        enableAutomaticMarkup ?? true,
        defaultMarkupPercentage || 0.00,
        markupPriority ? JSON.stringify(markupPriority) : JSON.stringify(["subcategory", "category", "brand", "supplier"]),
        enableLineVoidAuth ?? false,
        lineVoidAuthUsername || null,
        lineVoidAuthPassword || null,
        enableVoidReturnAuth ?? false,
        voidAuthUsername || null,
        voidAuthPassword || null,
        enableReturnAuth ?? false,
        returnAuthUsername || null,
        returnAuthPassword || null,
        enableRecentSalesAuth ?? false,
        recentSalesAuthUsername || null,
        recentSalesAuthPassword || null,
        paperSize || '58mm',
        printMode || 'browser',
        enableNegativeInventory ?? false,
        enableCashCountAuth ?? false,
        cashCountAuthUsername || null,
        cashCountAuthPassword || null,
        lowStockThreshold || 10,
        enableEmailNotifications ?? false,
        notificationEmail || null,
        enablePushNotifications ?? true,
        enableTaxRatesAuth ?? false,
        taxRatesAuthUsername || null,
        taxRatesAuthPassword || null,
        fiscalYearStartMonth || 1,
        printTwoReceipts ?? false,
        nativePrinterName || 'XP-58-P',
        body.requireAdjustmentConfirmation ?? false,
        body.requireTransferConfirmation ?? false,
        body.requirePurchaseOrderConfirmation ?? false,
        body.requireReceiveConfirmation ?? false,
        body.requireBadOrderConfirmation ?? false,
        body.requireStockCountApproval ?? false,
        body.requireRepackagingConfirmation ?? false,
        body.requireShelfTransferApproval ?? false,
        body.requireProductConfirmation ?? false,
        body.requirePriceUpdateConfirmation ?? false,
        enableOverallReadingAuth ?? false,
        overallReadingAuthUsername || null,
        overallReadingAuthPassword || null
      ]);
    } else {
      // Update existing settings - Dynamic Update
      const allowedFields: Record<string, string> = {
        businessName: 'business_name',
        logoPath: 'logo_path',
        transactionPrefix: 'transaction_prefix',
        address: 'address',
        contactNumber: 'contact_number',
        tin: 'tin',
        email: 'email',
        currencySymbol: 'currency_symbol',
        currencyCode: 'currency_code',
        timezone: 'timezone',
        dateFormat: 'date_format',
        enableAutomaticMarkup: 'enable_automatic_markup',
        defaultMarkupPercentage: 'default_markup_percentage',
        markupPriority: 'markup_priority',
        enableLineVoidAuth: 'enable_line_void_auth',
        lineVoidAuthUsername: 'line_void_auth_username',
        lineVoidAuthPassword: 'line_void_auth_password',
        enableVoidReturnAuth: 'enable_void_return_auth',
        voidAuthUsername: 'void_auth_username',
        voidAuthPassword: 'void_auth_password',
        enableReturnAuth: 'enable_return_auth',
        returnAuthUsername: 'return_auth_username',
        returnAuthPassword: 'return_auth_password',
        enableRecentSalesAuth: 'enable_recent_sales_auth',
        recentSalesAuthUsername: 'recent_sales_auth_username',
        recentSalesAuthPassword: 'recent_sales_auth_password',
        paperSize: 'paper_size',
        printMode: 'print_mode',
        enableNegativeInventory: 'enable_negative_inventory',
        enableCashCountAuth: 'enable_cash_count_auth',
        cashCountAuthUsername: 'cash_count_auth_username',
        cashCountAuthPassword: 'cash_count_auth_password',
        showQuantityInSearch: 'show_quantity_in_search',
        enablePriceEditAuth: 'enable_price_edit_auth',
        priceEditAuthUsername: 'price_edit_auth_username',
        priceEditAuthPassword: 'price_edit_auth_password',
        enableEditItemAuth: 'enable_edit_item_auth',
        editItemAuthUsername: 'edit_item_auth_username',
        editItemAuthPassword: 'edit_item_auth_password',
        enableSuspendAuth: 'enable_suspend_auth',
        suspendAuthUsername: 'suspend_auth_username',
        suspendAuthPassword: 'suspend_auth_password',
        enableSuspendedAuth: 'enable_suspended_auth',
        suspendedAuthUsername: 'suspended_auth_username',
        suspendedAuthPassword: 'suspended_auth_password',
        operatedBy: 'operated_by',
        minNumber: 'min_number',
        serialNumber: 'serial_number',
        lowStockThreshold: 'low_stock_threshold',
        enableEmailNotifications: 'enable_email_notifications',
        notificationEmail: 'notification_email',
        enablePushNotifications: 'enable_push_notifications',
        isTrainingMode: 'is_training_mode',
        enableTaxRatesAuth: 'enable_tax_rates_auth',
        taxRatesAuthUsername: 'tax_rates_auth_username',
        taxRatesAuthPassword: 'tax_rates_auth_password',
        fiscalYearStartMonth: 'fiscal_year_start_month',
        printTwoReceipts: 'print_two_receipts',
        nativePrinterName: 'native_printer_name',
        requireAdjustmentConfirmation: 'require_adjustment_confirmation',
        requireTransferConfirmation: 'require_transfer_confirmation',
        requirePurchaseOrderConfirmation: 'require_po_confirmation',
        requireReceiveConfirmation: 'require_receive_confirmation',
        requireBadOrderConfirmation: 'require_bad_order_confirmation',
        requireStockCountApproval: 'require_stock_count_approval',
        requireRepackagingConfirmation: 'require_repackaging_confirmation',
        requireShelfTransferApproval: 'require_shelf_transfer_confirmation',
        requireProductConfirmation: 'require_product_confirmation',
        requirePriceUpdateConfirmation: 'require_price_update_confirmation',
        batchCostingRepackInherit: 'batch_costing_repack_inherit',
        batchCostingOversellBlock: 'batch_costing_oversell_block',
        enableOverallReadingAuth: 'enable_overall_reading_auth',
        overallReadingAuthUsername: 'overall_reading_auth_username',
        overallReadingAuthPassword: 'overall_reading_auth_password',
        enableCustomerDisplay: 'enable_customer_display',
        customerDisplayMessage: 'customer_display_message',
        customerDisplayShowLogo: 'customer_display_show_logo',
        vatRegistration: 'vat_registration',
        salesOrderTerms: 'sales_order_terms',
        enableCashTransferAuth: 'enable_cash_transfer_auth',
        cashTransferAuthUsername: 'cash_transfer_auth_username',
        cashTransferAuthPassword: 'cash_transfer_auth_password',
        posMode: 'pos_mode',
        membershipFee: 'membership_fee',
        membershipDurationMonths: 'membership_duration_months'
      };

      const updates: string[] = [];
      const values: any[] = [];

      for (const [key, val] of Object.entries(body)) {
        if (allowedFields[key] && val !== undefined) {
          updates.push(`${allowedFields[key]} = ?`);
          
          if (key === 'markupPriority' && Array.isArray(val)) {
             values.push(JSON.stringify(val));
          } else {
             values.push(val);
          }
        }
      }

      if (updates.length > 0) {
        const updateSQL = `UPDATE pos_settings SET ${updates.join(', ')} WHERE id = ?`;
        values.push(existing[0].id);
        await query(updateSQL, values);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'POS settings updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error updating POS settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update POS settings' },
      { status: 500 }
    );
  }
}
