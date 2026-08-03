// Load all migrations
import './001_initial_schema';
import './002_drop_conversion_factor_from_units_of_measure';
import './003_create_conversion_factors_table';
import './004_alter_conversion_factors_id_length';
import './005_remove_is_serialized_from_products';
import './006_create_suppliers_table';
import './007_alter_suppliers_table_add_fields';
import './008_create_stock_adjustments_table';
import './009_add_account_foreign_keys_to_products';
import './010_create_stock_movements_table';
import './011_create_sales_transactions_tables';
import './012_create_pos_tables';
import './013_create_sales_orders_table';
import './014_alter_customers_table_add_fields';
import './015_alter_sales_orders_add_new_fields';
import './016_alter_customers_table_add_sales_fields';
import './017_create_loyalty_points_settings_table';
import './018_create_customer_loyalty_table';
import './019_create_point_history_table';
import './020_create_customer_payments_table';
import './021_create_sales_invoices_table';
import './022_create_warehouses_table';
import './023_add_warehouse_foreign_key_to_products';
import './024_alter_sales_invoices_add_sales_person';
import './025_add_sales_person_foreign_keys';
import './026_update_warehouse_foreign_key_constraint';
import './027_create_purchase_orders_table';
import './028_drop_account_foreign_keys_from_products';
import './029_create_user_permissions_table';
import './030_create_users_table';
import './031_alter_users_table_remove_email';
import './032_add_password_to_users_table';
import './033_alter_loyalty_base_column';
import './034_create_payment_details_tables';
import './035_create_pos_settings_table';
import './036_create_supplier_product_mapping';
import './037_alter_pos_settings_add_contact_fields';
import './038_create_supplier_payments_table';
import './039_alter_suppliers_add_details';
import './040_add_unique_constraint_conversion_factors';
import './040_alter_products_add_vat_and_availability';
import './042_alter_purchase_order_items_new_fields';
import './043_alter_purchase_orders_add_tracking_fields';
import './044_alter_purchase_orders_add_reference_number';
import './045_add_tax_rates';
import './046_add_markup_percentage_to_categories_brands';
import './047_alter_sales_transactions_add_voided_status';
import './048_alter_pos_settings_add_return_auth';
import './049_alter_pos_settings_add_recent_sales_auth';
import './050_create_bad_orders_table';
import './051_create_cash_transfers_table';
import './052_add_expiration_date_fields';
import './053_alter_payment_methods_add_require_reference';
import './054_add_payment_reference_to_sales_tables';
import './055_add_partially_paid_status';
import './056_update_product_sku_index';
import './057_create_stock_counts_tables';
import './058_create_shelf_locations_table';
import './059_add_locations_to_stock_counts';
import './060_alter_loyalty_points_precision';
import './061_add_bir_compliance_columns';
import './062_add_counters_to_z_readings';
import './063_add_is_training_to_pos_transactions';
import './064_add_is_training_to_all_sales_tables';
import './065_create_departments_table';
import './066_create_product_shelves_table';
import './067_add_quantity_to_product_shelves';
import './068_update_stock_movements_reference_type';
import './070_create_user_types_tables';
import './071_create_repackaging_logs_table';
import './072_add_repackaging_approval_setting';
import './073_alter_stock_adjustments_add_metadata_fields';
import './074_create_inventory_transfers_table';
import './075_add_warehouse_id_to_stock_movements';
import './076_add_warehouse_to_purchase_orders';
import './077_add_subtotal_to_purchase_order_items';
import './078_alter_stock_precision';
import './079_create_payment_allocations_table';
import './080_backfill_payment_allocations';
import './081_normalize_payment_invoice_notes';
import './082_alter_pos_settings_add_vat_registration';
import './083_add_si_number_to_tables';
import './084_add_si_number_to_transaction_references';
import './085_backfill_si_numbers';
import './086_redesign_sales_order_flow';
import './087_add_due_date_to_purchase_orders';
import './088_create_supplier_credit_memos_table';
import './089_seed_default_units_of_measure';
import './090_create_sync_tombstones_table';
import './091_add_si_prefix_to_transaction_references';
import './092_create_stock_movement_applied_table';
import './093_backfill_stock_movement_applied';
import './094_create_sync_conflicts_table';
import './095_dedupe_external_api_logs';
import './096_create_membership_payments';
import './097_add_product_approval_setting';
import './098_fix_si_number_initial_value';
import './099_add_mc_number';
import './100_add_expiration_tracking';
import './101_add_product_type';
import './102_unique_sales_order_reference';
import './103_stock_count_movement_aware_variance';
import './104_stock_count_subsecond_precision';
import './105_sta_lucia_integration';
import './106_sta_lucia_submission_claims';
import './107_add_price_update_approval_setting';

// Import runner functions
import { migrateUp, migrateDown } from './runner';

// Export the runner functions for CLI usage
export { migrateUp, migrateDown } from './runner';

// CLI runner
async function main() {
  const command = process.argv[2];

  if (command === 'up' || command === undefined) {
    await migrateUp();
  } else if (command === 'down') {
    await migrateDown();
  } else {
    console.log('Usage: tsx scripts/migrations/index.ts [up|down]');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
