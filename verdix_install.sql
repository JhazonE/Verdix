-- Vendix install DB: full structure + reference data + default admin
SET FOREIGN_KEY_CHECKS=0;

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `type` enum('income','expense') NOT NULL,
  `code` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_account_name` (`name`),
  UNIQUE KEY `unique_account_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `approval_history` (
  `id` varchar(36) NOT NULL,
  `approval_queue_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `action` enum('Approve','Reject') NOT NULL,
  `notes` text,
  `step_number` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `approval_queue` (
  `id` varchar(36) NOT NULL,
  `transaction_type` varchar(50) NOT NULL,
  `transaction_data` json NOT NULL,
  `status` enum('Pending','Approved','Rejected') DEFAULT 'Pending',
  `current_step` int DEFAULT '1',
  `created_by` varchar(36) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `approval_workflows` (
  `id` varchar(36) NOT NULL,
  `transaction_type` varchar(50) NOT NULL,
  `user_type_id` varchar(36) NOT NULL,
  `step_order` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `bad_order_items` (
  `id` varchar(50) NOT NULL,
  `bad_order_id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `cost` decimal(10,2) NOT NULL,
  `reason` enum('Damaged','Defective','Expired','Wrong Item','Missing','Other') NOT NULL,
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bad_order_id` (`bad_order_id`),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_reason` (`reason`),
  CONSTRAINT `bad_order_items_ibfk_1` FOREIGN KEY (`bad_order_id`) REFERENCES `bad_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `bad_order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `bad_orders` (
  `id` varchar(50) NOT NULL,
  `purchase_order_id` varchar(50) DEFAULT NULL,
  `supplier_id` varchar(50) DEFAULT NULL,
  `supplier_name` varchar(255) DEFAULT NULL,
  `reported_by` varchar(255) DEFAULT NULL,
  `report_date` datetime NOT NULL,
  `status` enum('Reported','Return Requested','Replaced','Credited','Resolved') DEFAULT 'Reported',
  `total_affected_value` decimal(10,2) NOT NULL DEFAULT '0.00',
  `notes` text,
  `resolution_notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `warehouse_id` varchar(50) DEFAULT NULL,
  `warehouse_name` varchar(255) DEFAULT NULL,
  `shelf_id` varchar(50) DEFAULT NULL,
  `shelf_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_purchase_order_id` (`purchase_order_id`),
  KEY `idx_supplier_id` (`supplier_id`),
  KEY `idx_report_date` (`report_date`),
  KEY `idx_status` (`status`),
  CONSTRAINT `bad_orders_ibfk_1` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `bad_orders_ibfk_2` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `brands` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `markup_percentage` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cash_transfers` (
  `id` varchar(50) NOT NULL,
  `shift_id` varchar(50) DEFAULT NULL,
  `terminal_id` varchar(50) DEFAULT NULL,
  `user_id` varchar(255) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `type` enum('deposit','pickup') NOT NULL,
  `reason` text,
  `transaction_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_shift_id` (`shift_id`),
  KEY `idx_terminal_id` (`terminal_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_transaction_time` (`transaction_time`),
  KEY `idx_type` (`type`),
  CONSTRAINT `cash_transfers_ibfk_1` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_transfers_ibfk_2` FOREIGN KEY (`terminal_id`) REFERENCES `pos_terminals` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_transfers_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `categories` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `markup_percentage` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `cloud_sync_tracker` (
  `table_name` varchar(100) NOT NULL,
  `last_push_at` timestamp NOT NULL DEFAULT '1999-12-31 16:00:00',
  `last_pull_at` timestamp NULL DEFAULT NULL,
  `last_push_id` varchar(100) NOT NULL DEFAULT '',
  `last_pull_id` varchar(100) NOT NULL DEFAULT '',
  PRIMARY KEY (`table_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `conversion_factors` (
  `id` varchar(100) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `unit` varchar(100) NOT NULL,
  `factor` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_product_unit` (`product_id`,`unit`),
  CONSTRAINT `conversion_factors_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `customer_loyalty` (
  `id` varchar(50) NOT NULL,
  `customer_id` varchar(50) NOT NULL,
  `rfid_code` varchar(100) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `point_setting` varchar(100) DEFAULT NULL,
  `current_points` decimal(15,3) DEFAULT '0.000',
  `last_transaction` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rfid_code` (`rfid_code`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_rfid_code` (`rfid_code`),
  KEY `idx_expiry_date` (`expiry_date`),
  CONSTRAINT `customer_loyalty_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `customer_payments` (
  `id` varchar(255) NOT NULL,
  `customer_id` varchar(255) NOT NULL,
  `payment_type` varchar(100) NOT NULL,
  `payment_date` datetime NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `reference` varchar(100) NOT NULL,
  `note` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reference` (`reference`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_payment_date` (`payment_date`),
  KEY `idx_reference` (`reference`),
  CONSTRAINT `customer_payments_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `customers` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `payment_terms` varchar(100) DEFAULT NULL,
  `loyalty_points` decimal(15,3) DEFAULT '0.000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `address` text,
  `billing_address` text,
  `discount` decimal(5,2) DEFAULT '0.00',
  `credit_limit` decimal(15,2) DEFAULT '0.00',
  `active` tinyint(1) DEFAULT '1',
  `sales_person` varchar(100) DEFAULT NULL,
  `sales_area` varchar(100) DEFAULT NULL,
  `sales_group` varchar(100) DEFAULT NULL,
  `price_level_id` varchar(50) DEFAULT NULL,
  `credit_balance` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_name` (`name`),
  KEY `idx_contact_number` (`contact_number`),
  KEY `fk_customer_price_level` (`price_level_id`),
  CONSTRAINT `fk_customer_price_level` FOREIGN KEY (`price_level_id`) REFERENCES `price_levels` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `departments` (
  `id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `markup_percentage` decimal(10,2) DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `disabled_pages` (
  `page_key` varchar(100) NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`page_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `external_api_logs` (
  `id` varchar(50) NOT NULL,
  `transaction_type` varchar(50) NOT NULL,
  `transaction_id` varchar(50) NOT NULL,
  `endpoint` varchar(500) NOT NULL,
  `payload` text,
  `response` text,
  `status` varchar(20) NOT NULL,
  `error_message` text,
  `retry_count` int DEFAULT '0',
  `next_retry_at` datetime DEFAULT NULL,
  `last_retry_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_transaction_id` (`transaction_id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_sync_queue` (`status`,`next_retry_at`),
  KEY `idx_txn_status` (`transaction_type`,`transaction_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `external_api_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`)
) ENGINE=InnoDB AUTO_INCREMENT=2672 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `external_apis` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `api_endpoint` varchar(500) NOT NULL,
  `auth_type` enum('api_key','bearer_token','none') NOT NULL DEFAULT 'none',
  `api_key` varchar(500) DEFAULT NULL,
  `bearer_token` varchar(500) DEFAULT NULL,
  `allowed_methods` enum('send_only','receive_only','full_access') NOT NULL DEFAULT 'full_access',
  `timeout` int NOT NULL DEFAULT '30000',
  `retry_attempts` int NOT NULL DEFAULT '3',
  `retry_delay` int NOT NULL DEFAULT '2000',
  `sync_mode` enum('realtime','batch') NOT NULL DEFAULT 'realtime',
  `on_error_action` enum('retry','queue','log_only') NOT NULL DEFAULT 'log_only',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `role` enum('general','cloud_sync') NOT NULL DEFAULT 'general',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_batches` (
  `id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `purchase_order_id` varchar(50) DEFAULT NULL,
  `received_date` date NOT NULL,
  `quantity_in` decimal(14,4) NOT NULL,
  `quantity_remaining` decimal(14,4) NOT NULL,
  `unit_cost` decimal(14,4) NOT NULL,
  `selling_price` decimal(10,2) NOT NULL,
  `source_type` varchar(30) DEFAULT 'purchase',
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `expiration_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ib_product` (`product_id`),
  KEY `idx_ib_po` (`purchase_order_id`),
  KEY `idx_ib_date` (`received_date`),
  KEY `idx_ib_expiration` (`expiration_date`),
  CONSTRAINT `inventory_batches_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_transfer_items` (
  `id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `transfer_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(15,4) NOT NULL,
  `unit_of_measure` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transfer_id` (`transfer_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `fk_transfer_id` FOREIGN KEY (`transfer_id`) REFERENCES `inventory_transfers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `inventory_transfers` (
  `id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_warehouse_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_warehouse_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `transfer_date` datetime NOT NULL,
  `reference` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'Completed',
  `notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_source_warehouse` (`source_warehouse_id`),
  KEY `idx_target_warehouse` (`target_warehouse_id`),
  KEY `idx_transfer_date` (`transfer_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `loyalty_points_settings` (
  `id` varchar(50) NOT NULL,
  `description` varchar(255) NOT NULL,
  `base` varchar(50) NOT NULL DEFAULT 'amount',
  `amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `equivalent` decimal(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_description` (`description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `membership_payments` (
  `id` varchar(50) NOT NULL,
  `customer_id` varchar(50) NOT NULL,
  `customer_loyalty_id` varchar(50) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_method` varchar(20) NOT NULL,
  `previous_expiry` date DEFAULT NULL,
  `new_expiry` date NOT NULL,
  `is_new_card` tinyint(1) NOT NULL DEFAULT '0',
  `shift_id` varchar(50) DEFAULT NULL,
  `terminal_id` varchar(50) DEFAULT NULL,
  `user_id` varchar(50) NOT NULL,
  `pos_transaction_id` varchar(50) DEFAULT NULL,
  `receipt_number` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_shift_id` (`shift_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `timestamp` varchar(50) NOT NULL,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=106 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `payment_allocations` (
  `id` varchar(255) NOT NULL,
  `payment_id` varchar(255) NOT NULL,
  `invoice_id` varchar(255) NOT NULL,
  `amount_allocated` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payment_id` (`payment_id`),
  KEY `idx_invoice_id` (`invoice_id`),
  CONSTRAINT `fk_pa_payment` FOREIGN KEY (`payment_id`) REFERENCES `customer_payments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `payment_audit_log` (
  `id` varchar(50) NOT NULL,
  `transaction_id` varchar(50) DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `action` varchar(50) NOT NULL,
  `status` varchar(50) NOT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `error_message` text,
  `details` text,
  `user_id` varchar(50) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transaction_id` (`transaction_id`),
  KEY `idx_payment_method` (`payment_method`),
  KEY `idx_action` (`action`),
  KEY `idx_status` (`status`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `payment_details` (
  `id` varchar(50) NOT NULL,
  `transaction_id` varchar(50) NOT NULL,
  `payment_method` varchar(50) NOT NULL,
  `card_type` varchar(50) DEFAULT NULL,
  `card_last_four` varchar(4) DEFAULT NULL,
  `auth_code` varchar(50) DEFAULT NULL,
  `gateway_reference` varchar(100) DEFAULT NULL,
  `wallet_provider` varchar(50) DEFAULT NULL,
  `wallet_reference` varchar(100) DEFAULT NULL,
  `gift_check_number` varchar(50) DEFAULT NULL,
  `gift_check_balance_before` decimal(10,2) DEFAULT NULL,
  `gift_check_balance_after` decimal(10,2) DEFAULT NULL,
  `points_used` decimal(10,2) DEFAULT NULL,
  `points_remaining` decimal(10,2) DEFAULT NULL,
  `points_conversion_rate` decimal(10,4) DEFAULT NULL,
  `amount_tendered` decimal(10,2) DEFAULT NULL,
  `change_given` decimal(10,2) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transaction_id` (`transaction_id`),
  KEY `idx_payment_method` (`payment_method`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `payment_details_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `pos_transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `payment_methods` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `require_reference` tinyint(1) DEFAULT '0',
  `points_amount` decimal(10,2) DEFAULT NULL,
  `currency_equivalent` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_name` (`name`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `payment_term_types` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_name` (`name`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `payment_terms` (
  `id` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `type` varchar(50) DEFAULT NULL,
  `number_of_days_month` varchar(50) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_description` (`description`),
  KEY `idx_type` (`type`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `point_history` (
  `id` varchar(50) NOT NULL,
  `customer_loyalty_id` varchar(50) NOT NULL,
  `transaction_type` enum('add','remove','purchase','redemption','expiration','adjustment') NOT NULL,
  `points` decimal(15,3) NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `transaction_reference` varchar(100) DEFAULT NULL,
  `created_by` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_loyalty_id` (`customer_loyalty_id`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `point_history_ibfk_1` FOREIGN KEY (`customer_loyalty_id`) REFERENCES `customer_loyalty` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pos_queue_counter` (
  `id` int NOT NULL DEFAULT '1',
  `current_number` int NOT NULL DEFAULT '0',
  `max_number` int NOT NULL DEFAULT '999',
  `auto_reset_daily` tinyint(1) NOT NULL DEFAULT '1',
  `last_reset_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_reset_date` date DEFAULT (curdate()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pos_queued_orders` (
  `id` varchar(36) NOT NULL,
  `queue_number` int NOT NULL AUTO_INCREMENT,
  `daily_queue_number` int NOT NULL DEFAULT '1',
  `items` json NOT NULL,
  `customer_id` varchar(36) DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT 'Walk-in',
  `queue_notes` text,
  `frontliner_id` varchar(36) NOT NULL,
  `frontliner_name` varchar(255) DEFAULT NULL,
  `terminal_id` varchar(36) DEFAULT NULL,
  `terminal_name` varchar(255) DEFAULT NULL,
  `shift_id` varchar(36) DEFAULT NULL,
  `status` enum('pending','claimed','completed','cancelled') DEFAULT 'pending',
  `claimed_by` varchar(36) DEFAULT NULL,
  `claimed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `queue_number` (`queue_number`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pos_settings` (
  `id` varchar(50) NOT NULL,
  `business_name` varchar(255) NOT NULL,
  `logo_path` varchar(500) DEFAULT NULL,
  `enable_advanced_inventory` tinyint(1) DEFAULT '0',
  `transaction_prefix` varchar(20) DEFAULT 'TXN',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `address` text,
  `contact_number` varchar(50) DEFAULT NULL,
  `tin` varchar(50) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `currency_symbol` varchar(10) DEFAULT '$',
  `currency_code` varchar(10) DEFAULT 'USD',
  `timezone` varchar(100) DEFAULT 'UTC',
  `date_format` varchar(20) DEFAULT 'MM/DD/YYYY',
  `enable_automatic_markup` tinyint(1) DEFAULT '1',
  `default_markup_percentage` decimal(5,2) DEFAULT '0.00',
  `markup_priority` json DEFAULT NULL,
  `enable_void_return_auth` tinyint(1) DEFAULT '0',
  `void_auth_username` varchar(255) DEFAULT NULL,
  `void_auth_password` varchar(255) DEFAULT NULL,
  `enable_return_auth` tinyint(1) DEFAULT '0',
  `return_auth_username` varchar(255) DEFAULT NULL,
  `return_auth_password` varchar(255) DEFAULT NULL,
  `enable_recent_sales_auth` tinyint(1) DEFAULT '0',
  `recent_sales_auth_username` varchar(255) DEFAULT NULL,
  `recent_sales_auth_password` varchar(255) DEFAULT NULL,
  `paper_size` enum('58mm','80mm') DEFAULT '58mm',
  `print_mode` enum('browser','escpos','usb','native') DEFAULT 'browser',
  `enable_negative_inventory` tinyint(1) DEFAULT '0',
  `enable_cash_count_auth` tinyint(1) DEFAULT '0',
  `cash_count_auth_username` varchar(255) DEFAULT NULL,
  `cash_count_auth_password` varchar(255) DEFAULT NULL,
  `enable_line_void_auth` tinyint(1) DEFAULT '0',
  `line_void_auth_username` varchar(255) DEFAULT NULL,
  `line_void_auth_password` varchar(255) DEFAULT NULL,
  `show_quantity_in_search` tinyint(1) DEFAULT '1',
  `enable_price_edit_auth` tinyint(1) DEFAULT '0',
  `price_edit_auth_username` varchar(255) DEFAULT NULL,
  `price_edit_auth_password` varchar(255) DEFAULT NULL,
  `operated_by` varchar(255) DEFAULT NULL,
  `min_number` varchar(100) DEFAULT NULL,
  `serial_number` varchar(100) DEFAULT NULL,
  `low_stock_threshold` int DEFAULT '10',
  `enable_email_notifications` tinyint(1) DEFAULT '0',
  `notification_email` varchar(255) DEFAULT NULL,
  `enable_push_notifications` tinyint(1) DEFAULT '1',
  `is_training_mode` tinyint(1) DEFAULT '0',
  `last_ejournal_export` timestamp NULL DEFAULT NULL,
  `enable_tax_rates_auth` tinyint(1) DEFAULT '0',
  `tax_rates_auth_username` varchar(255) DEFAULT NULL,
  `tax_rates_auth_password` varchar(255) DEFAULT NULL,
  `fiscal_year_start_month` int DEFAULT '1',
  `print_two_receipts` tinyint(1) DEFAULT '0',
  `native_printer_name` varchar(255) DEFAULT 'XP-58-P',
  `require_adjustment_confirmation` tinyint(1) DEFAULT '0',
  `require_transfer_confirmation` tinyint(1) DEFAULT '0',
  `require_po_confirmation` tinyint(1) DEFAULT '0',
  `require_receive_confirmation` tinyint(1) DEFAULT '0',
  `require_bad_order_confirmation` tinyint(1) DEFAULT '0',
  `require_stock_count_approval` tinyint(1) DEFAULT '0',
  `require_repackaging_confirmation` tinyint(1) NOT NULL DEFAULT '0',
  `batch_costing_repack_inherit` tinyint(1) DEFAULT '1',
  `batch_costing_oversell_block` tinyint(1) DEFAULT '0',
  `require_shelf_transfer_confirmation` tinyint(1) DEFAULT '0',
  `enable_overall_reading_auth` tinyint(1) DEFAULT '0',
  `overall_reading_auth_username` varchar(255) DEFAULT NULL,
  `overall_reading_auth_password` varchar(255) DEFAULT NULL,
  `enable_customer_display` tinyint(1) DEFAULT '0',
  `customer_display_message` varchar(255) DEFAULT 'Welcome! Thank you for shopping.',
  `customer_display_show_logo` tinyint(1) DEFAULT '1',
  `vat_registration` varchar(20) DEFAULT 'VAT',
  `sales_order_terms` text,
  `enable_cash_transfer_auth` tinyint(1) DEFAULT '0',
  `cash_transfer_auth_username` varchar(255) DEFAULT NULL,
  `cash_transfer_auth_password` varchar(255) DEFAULT NULL,
  `pos_mode` enum('default','pharmacy') DEFAULT 'default',
  `enable_edit_item_auth` tinyint(1) DEFAULT '0',
  `edit_item_auth_username` varchar(255) DEFAULT NULL,
  `edit_item_auth_password` varchar(255) DEFAULT NULL,
  `enable_suspend_auth` tinyint(1) DEFAULT '0',
  `suspend_auth_username` varchar(255) DEFAULT NULL,
  `suspend_auth_password` varchar(255) DEFAULT NULL,
  `enable_suspended_auth` tinyint(1) DEFAULT '0',
  `suspended_auth_username` varchar(255) DEFAULT NULL,
  `suspended_auth_password` varchar(255) DEFAULT NULL,
  `membership_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `membership_duration_months` int NOT NULL DEFAULT '12',
  `require_product_confirmation` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pos_terminals` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `location` varchar(255) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `x_counter` int DEFAULT '0',
  `serial_number` varchar(100) DEFAULT NULL,
  `min_number` varchar(100) DEFAULT NULL,
  `permit_no` varchar(100) DEFAULT NULL,
  `print_official_receipt` varchar(10) DEFAULT 'No',
  `or_next_reference` varchar(100) DEFAULT NULL,
  `last_active` timestamp NULL DEFAULT NULL,
  `z_counter` int DEFAULT '0',
  `reset_counter` int DEFAULT '0',
  `terminal_min` varchar(50) DEFAULT NULL,
  `terminal_serial_number` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_name` (`name`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pos_transaction_items` (
  `id` varchar(50) NOT NULL,
  `pos_transaction_id` varchar(50) NOT NULL,
  `sale_item_id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `unit_price` decimal(10,2) NOT NULL,
  `discount_percentage` decimal(5,2) DEFAULT '0.00',
  `discount_amount` decimal(10,2) DEFAULT '0.00',
  `line_total` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `discount_type` varchar(50) DEFAULT 'percent',
  `tax_type` varchar(50) DEFAULT 'VAT',
  `discount_id_number` varchar(100) DEFAULT NULL,
  `discount_holder_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pos_transaction_id` (`pos_transaction_id`),
  KEY `idx_sale_item_id` (`sale_item_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `pos_transaction_items_ibfk_1` FOREIGN KEY (`pos_transaction_id`) REFERENCES `pos_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pos_transaction_items_ibfk_2` FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pos_transaction_items_ibfk_3` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pos_transactions` (
  `id` varchar(50) NOT NULL,
  `sale_id` varchar(50) NOT NULL,
  `shift_id` varchar(50) DEFAULT NULL,
  `user_id` varchar(255) NOT NULL,
  `terminal_id` varchar(50) DEFAULT NULL,
  `transaction_type` enum('sale','void','return','refund','membership') DEFAULT 'sale',
  `subtotal` decimal(10,2) NOT NULL,
  `tax_amount` decimal(10,2) DEFAULT '0.00',
  `discount_amount` decimal(10,2) DEFAULT '0.00',
  `total_amount` decimal(10,2) NOT NULL,
  `payment_method` varchar(100) DEFAULT NULL,
  `payment_reference` varchar(255) DEFAULT NULL,
  `customer_count` int DEFAULT '1',
  `transaction_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `void_reason` text,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `payment_status` varchar(50) DEFAULT 'completed',
  `payment_details_id` varchar(50) DEFAULT NULL,
  `payment_validated_at` timestamp NULL DEFAULT NULL,
  `order_number` int NOT NULL AUTO_INCREMENT,
  `si_number` varchar(50) DEFAULT NULL,
  `is_training` tinyint(1) DEFAULT '0',
  `mc_number` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_number` (`order_number`),
  UNIQUE KEY `si_number` (`si_number`),
  UNIQUE KEY `idx_pos_transactions_mc_number` (`mc_number`),
  KEY `idx_sale_id` (`sale_id`),
  KEY `idx_shift_id` (`shift_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_terminal_id` (`terminal_id`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_transaction_time` (`transaction_time`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_pos_transactions_si_number` (`si_number`),
  CONSTRAINT `pos_transactions_ibfk_1` FOREIGN KEY (`sale_id`) REFERENCES `sales_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `pos_transactions_ibfk_2` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `pos_transactions_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`uid`) ON DELETE CASCADE,
  CONSTRAINT `pos_transactions_ibfk_4` FOREIGN KEY (`terminal_id`) REFERENCES `pos_terminals` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `price_levels` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `calculation_base` enum('retail','cost') DEFAULT 'retail',
  `description` text,
  `is_default` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `percentage_adjustment` decimal(10,2) DEFAULT '100.00',
  `min_quantity` int DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_name` (`name`),
  KEY `idx_is_default` (`is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `product_price_levels` (
  `product_id` varchar(50) NOT NULL,
  `price_level_id` varchar(50) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `min_quantity` int DEFAULT '0',
  PRIMARY KEY (`product_id`,`price_level_id`),
  KEY `price_level_id` (`price_level_id`),
  CONSTRAINT `product_price_levels_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `product_price_levels_ibfk_2` FOREIGN KEY (`price_level_id`) REFERENCES `price_levels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `product_shelves` (
  `product_id` varchar(50) NOT NULL,
  `shelf_id` varchar(50) NOT NULL,
  `quantity` decimal(15,4) NOT NULL DEFAULT '0.0000',
  PRIMARY KEY (`product_id`,`shelf_id`),
  KEY `shelf_id` (`shelf_id`),
  CONSTRAINT `product_shelves_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `product_shelves_ibfk_2` FOREIGN KEY (`shelf_id`) REFERENCES `shelf_locations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `products` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `additional_description` text,
  `category` varchar(100) DEFAULT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `department` varchar(255) DEFAULT NULL,
  `subcategory` varchar(100) DEFAULT NULL,
  `stock` decimal(15,4) DEFAULT '0.0000',
  `reorder_point` decimal(15,4) DEFAULT '0.0000',
  `avg_daily_sales` decimal(10,2) DEFAULT '0.00',
  `price` decimal(10,2) NOT NULL,
  `cost` decimal(10,2) DEFAULT NULL,
  `sku` varchar(100) DEFAULT NULL,
  `barcode` varchar(100) DEFAULT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `image_hint` varchar(255) DEFAULT NULL,
  `unit_of_measure` varchar(50) DEFAULT NULL,
  `parent_id` varchar(50) DEFAULT NULL,
  `conversion_factor` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `supplier_id` varchar(50) DEFAULT NULL,
  `income_account` varchar(50) DEFAULT NULL,
  `expense_account` varchar(50) DEFAULT NULL,
  `warehouse_id` varchar(50) DEFAULT NULL,
  `vat_status` varchar(50) DEFAULT 'YES (Subject to 12% VAT)',
  `availability` varchar(20) DEFAULT 'Available',
  `earns_points` tinyint(1) DEFAULT '1',
  `expiration_date` date DEFAULT NULL,
  `shelf_location_id` varchar(50) DEFAULT NULL,
  `is_perishable` tinyint(1) NOT NULL DEFAULT '0',
  `type` enum('standard','service') NOT NULL DEFAULT 'standard',
  PRIMARY KEY (`id`),
  UNIQUE KEY `sku_warehouse` (`sku`,`warehouse_id`),
  KEY `parent_id` (`parent_id`),
  KEY `supplier_id` (`supplier_id`),
  KEY `fk_products_income_account` (`income_account`),
  KEY `fk_products_expense_account` (`expense_account`),
  KEY `fk_products_warehouse` (`warehouse_id`),
  KEY `fk_products_shelf_location` (`shelf_location_id`),
  KEY `idx_products_type` (`type`),
  CONSTRAINT `fk_products_shelf_location` FOREIGN KEY (`shelf_location_id`) REFERENCES `shelf_locations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_products_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `products` (`id`),
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `purchase_order_items` (
  `id` varchar(50) NOT NULL,
  `purchase_order_id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `quantity` int NOT NULL,
  `cost` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `selling_price` decimal(10,2) DEFAULT NULL,
  `discount` decimal(10,2) DEFAULT '0.00',
  `discount_type` varchar(20) DEFAULT 'amount',
  `vat_subject` tinyint(1) DEFAULT '0',
  `expiration_date` date DEFAULT NULL,
  `subtotal` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_purchase_order_id` (`purchase_order_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `purchase_order_items_ibfk_1` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `purchase_order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `purchase_order_payments` (
  `id` varchar(50) NOT NULL,
  `supplier_payment_id` varchar(50) NOT NULL,
  `purchase_order_id` varchar(50) NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `supplier_payment_id` (`supplier_payment_id`),
  KEY `purchase_order_id` (`purchase_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id` varchar(50) NOT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `supplier_id` varchar(50) NOT NULL,
  `supplier_name` varchar(255) NOT NULL,
  `ordered_by` varchar(255) DEFAULT NULL,
  `date` datetime NOT NULL,
  `due_date` date DEFAULT NULL,
  `delivery_date` datetime DEFAULT NULL,
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `received_total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `shipping_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  `vat_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `payment_method` varchar(100) DEFAULT NULL,
  `status` enum('Pending','Approved','Paid','Shipped','Received','Failed','Cancelled','Partially Paid') DEFAULT 'Pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `paid_amount` decimal(15,2) DEFAULT '0.00',
  `warehouse_id` varchar(50) DEFAULT NULL,
  `warehouse_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_supplier_id` (`supplier_id`),
  KEY `idx_date` (`date`),
  KEY `idx_status` (`status`),
  KEY `idx_payment_method` (`payment_method`),
  CONSTRAINT `purchase_orders_ibfk_1` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `repackaging_logs` (
  `id` varchar(100) NOT NULL,
  `source_product_id` varchar(100) NOT NULL,
  `source_product_name` varchar(255) NOT NULL,
  `source_qty` decimal(15,4) NOT NULL,
  `target_product_id` varchar(100) NOT NULL,
  `target_product_name` varchar(255) NOT NULL,
  `target_qty_produced` decimal(15,4) NOT NULL,
  `factor` decimal(15,4) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'completed',
  `approval_queue_id` varchar(100) DEFAULT NULL,
  `notes` text,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_source_product` (`source_product_id`),
  KEY `idx_target_product` (`target_product_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sale_items` (
  `id` varchar(50) NOT NULL,
  `sale_id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `quantity` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `cost_at_sale` decimal(14,4) DEFAULT NULL COMMENT 'Weighted avg cost from batch sources',
  `batch_source` json DEFAULT NULL COMMENT 'Array of batch splits',
  PRIMARY KEY (`id`),
  KEY `idx_sale_id` (`sale_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `sale_items_ibfk_1` FOREIGN KEY (`sale_id`) REFERENCES `sales_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `sale_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_areas` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_groups` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_invoice_items` (
  `id` varchar(50) NOT NULL,
  `sales_invoice_id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `quantity` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sales_invoice_id` (`sales_invoice_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `sales_invoice_items_ibfk_1` FOREIGN KEY (`sales_invoice_id`) REFERENCES `sales_invoices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `sales_invoice_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_invoices` (
  `id` varchar(50) NOT NULL,
  `reference` varchar(255) DEFAULT NULL,
  `sales_order_id` varchar(50) DEFAULT NULL,
  `receipt_number` varchar(100) DEFAULT NULL,
  `customer_id` varchar(50) DEFAULT NULL,
  `invoice_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `total` decimal(10,2) NOT NULL,
  `amount_paid` decimal(10,2) DEFAULT '0.00',
  `payment_method` varchar(100) DEFAULT NULL,
  `payment_reference` varchar(255) DEFAULT NULL,
  `sales_person_id` varchar(50) DEFAULT NULL,
  `status` enum('Paid','Pending','Failed','Shipped','Delivered','Returned','Partially Paid') DEFAULT 'Pending',
  `transaction_source` varchar(50) DEFAULT 'Backoffice',
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_training` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_invoice_date` (`invoice_date`),
  KEY `idx_due_date` (`due_date`),
  KEY `idx_status` (`status`),
  KEY `idx_payment_method` (`payment_method`),
  KEY `idx_sales_person_id` (`sales_person_id`),
  KEY `idx_sales_order_id` (`sales_order_id`),
  CONSTRAINT `fk_sales_invoices_sales_person_id` FOREIGN KEY (`sales_person_id`) REFERENCES `sales_persons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `sales_invoices_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_order_items` (
  `id` varchar(50) NOT NULL,
  `sales_order_id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `quantity` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sales_order_id` (`sales_order_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `sales_order_items_ibfk_1` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `sales_order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_orders` (
  `id` varchar(50) NOT NULL,
  `customer_id` varchar(50) DEFAULT NULL,
  `order_date` date NOT NULL,
  `delivery_date` date DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `delivery_address` text,
  `total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `shipping` decimal(10,2) DEFAULT '0.00',
  `warehouse_id` varchar(50) DEFAULT NULL,
  `sales_person_id` varchar(50) DEFAULT NULL,
  `note` text,
  `payment_method` varchar(100) DEFAULT NULL,
  `payment_reference` varchar(255) DEFAULT NULL,
  `status` enum('Pending','Delivered','Invoiced','Cancelled','Returned') DEFAULT 'Pending',
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_sales_orders_reference_unique` (`reference`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_order_date` (`order_date`),
  KEY `idx_delivery_date` (`delivery_date`),
  KEY `idx_status` (`status`),
  KEY `idx_reference` (`reference`),
  KEY `idx_warehouse_id` (`warehouse_id`),
  KEY `idx_sales_person_id` (`sales_person_id`),
  CONSTRAINT `fk_sales_orders_sales_person_id` FOREIGN KEY (`sales_person_id`) REFERENCES `sales_persons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `sales_orders_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_persons` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sales_transactions` (
  `id` varchar(50) NOT NULL,
  `reference` varchar(255) DEFAULT NULL,
  `receipt_number` varchar(100) DEFAULT NULL,
  `si_number` varchar(50) DEFAULT NULL,
  `customer_id` varchar(50) DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `total` decimal(10,2) NOT NULL,
  `payment_method` varchar(100) DEFAULT NULL,
  `status` enum('Paid','Pending','Failed','Shipped','Delivered','Returned','Partially Paid','Voided') DEFAULT 'Pending',
  `transaction_source` varchar(50) DEFAULT 'POS',
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_training` tinyint(1) DEFAULT '0',
  `void_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `si_number` (`si_number`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_date` (`date`),
  KEY `idx_invoice_date` (`invoice_date`),
  KEY `idx_status` (`status`),
  KEY `idx_payment_method` (`payment_method`),
  KEY `idx_sales_transactions_si_number` (`si_number`),
  CONSTRAINT `sales_transactions_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `shelf_locations` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `shifts` (
  `id` varchar(50) NOT NULL,
  `user_id` varchar(255) NOT NULL,
  `terminal_id` varchar(50) DEFAULT NULL,
  `start_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `end_time` timestamp NULL DEFAULT NULL,
  `starting_cash` decimal(10,2) DEFAULT '0.00',
  `expected_cash` decimal(10,2) DEFAULT '0.00',
  `actual_cash` decimal(10,2) DEFAULT '0.00',
  `cash_difference` decimal(10,2) DEFAULT '0.00',
  `cash_denominations` json DEFAULT NULL,
  `status` enum('active','completed','reconciled') DEFAULT 'active',
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_terminal_id` (`terminal_id`),
  KEY `idx_status` (`status`),
  KEY `idx_start_time` (`start_time`),
  CONSTRAINT `shifts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`uid`) ON DELETE CASCADE,
  CONSTRAINT `shifts_ibfk_2` FOREIGN KEY (`terminal_id`) REFERENCES `pos_terminals` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `stock_adjustments` (
  `id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `quantity` decimal(15,4) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `new_stock` decimal(15,4) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `warehouse_id` varchar(50) DEFAULT NULL,
  `target_warehouse_id` varchar(50) DEFAULT NULL,
  `reference_no` varchar(100) DEFAULT NULL,
  `supplier_id` varchar(50) DEFAULT NULL,
  `note` text,
  `adj_type` enum('add','remove','transfer') DEFAULT 'add',
  PRIMARY KEY (`id`),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `stock_adjustments_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `stock_count_items` (
  `id` varchar(50) NOT NULL,
  `stock_count_id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `snapshot_quantity` int NOT NULL,
  `counted_quantity` int DEFAULT NULL,
  `variance` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_stock_count_id` (`stock_count_id`),
  KEY `idx_product_id` (`product_id`),
  CONSTRAINT `stock_count_items_ibfk_1` FOREIGN KEY (`stock_count_id`) REFERENCES `stock_counts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `stock_count_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `stock_counts` (
  `id` varchar(50) NOT NULL,
  `status` enum('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
  `name` varchar(255) NOT NULL,
  `notes` text,
  `created_by` varchar(50) DEFAULT NULL,
  `completed_by` varchar(50) DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `warehouse_id` varchar(50) DEFAULT NULL,
  `shelf_location_id` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `fk_stock_counts_warehouse` (`warehouse_id`),
  KEY `fk_stock_counts_shelf` (`shelf_location_id`),
  CONSTRAINT `fk_stock_counts_shelf` FOREIGN KEY (`shelf_location_id`) REFERENCES `shelf_locations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_stock_counts_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `stock_movement_applied` (
  `movement_id` varchar(64) NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`movement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `stock_movements` (
  `id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `movement_type` enum('sale','purchase','adjustment','return','transfer','sales_order') NOT NULL,
  `quantity_change` decimal(15,4) NOT NULL,
  `previous_stock` decimal(15,4) NOT NULL,
  `new_stock` decimal(15,4) NOT NULL,
  `reference_id` varchar(50) DEFAULT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `expiration_date` date DEFAULT NULL,
  `warehouse_id` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_product_id` (`product_id`),
  KEY `idx_movement_type` (`movement_type`),
  KEY `idx_reference_id` (`reference_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_sm_warehouse_id` (`warehouse_id`),
  CONSTRAINT `stock_movements_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `subcategories` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `markup_percentage` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `supplier_credit_memos` (
  `id` varchar(50) NOT NULL,
  `supplier_id` varchar(50) NOT NULL,
  `purchase_order_id` varchar(50) DEFAULT NULL COMMENT 'Linked PO (optional)',
  `amount` decimal(15,2) NOT NULL,
  `date` date NOT NULL,
  `reason` varchar(100) NOT NULL DEFAULT 'Goods Return',
  `reference` varchar(100) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_supplier_id` (`supplier_id`),
  KEY `idx_date` (`date`),
  KEY `fk_scm_po` (`purchase_order_id`),
  CONSTRAINT `fk_scm_po` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_scm_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `supplier_payments` (
  `id` varchar(50) NOT NULL,
  `supplier_id` varchar(50) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `date` datetime NOT NULL,
  `payment_method` varchar(100) DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_supplier_id` (`supplier_id`),
  KEY `idx_date` (`date`),
  CONSTRAINT `supplier_payments_ibfk_1` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `supplier_product_mapping` (
  `id` varchar(50) NOT NULL,
  `product_id` varchar(50) NOT NULL,
  `supplier_id` varchar(50) NOT NULL,
  `supplier_sku` varchar(100) DEFAULT NULL,
  `supplier_lead_time` int DEFAULT '0' COMMENT 'Lead time in days',
  `supplier_specific_rop` int DEFAULT '0' COMMENT 'Reorder Point specific to this supplier',
  `supplier_cost` decimal(10,2) DEFAULT NULL,
  `is_primary` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_product_supplier` (`product_id`,`supplier_id`),
  KEY `supplier_id` (`supplier_id`),
  CONSTRAINT `supplier_product_mapping_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `supplier_product_mapping_ibfk_2` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `contact_number` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `address` text,
  `payment_terms` varchar(100) DEFAULT NULL,
  `markup_percentage` decimal(5,2) DEFAULT NULL,
  `telephone` varchar(50) DEFAULT NULL,
  `mobile_phone` varchar(50) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `company` varchar(255) DEFAULT NULL,
  `tin` varchar(50) DEFAULT NULL,
  `order_schedule` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sync_conflicts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `table_name` varchar(100) NOT NULL,
  `record_id` varchar(100) NOT NULL,
  `local_updated_at` datetime DEFAULT NULL,
  `cloud_updated_at` datetime DEFAULT NULL,
  `resolution` enum('cloud_won','local_won') NOT NULL,
  `detected_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_detected` (`detected_at`),
  KEY `idx_table_record` (`table_name`,`record_id`)
) ENGINE=InnoDB AUTO_INCREMENT=115 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `sync_tombstones` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `table_name` varchar(100) NOT NULL,
  `record_id` varchar(100) NOT NULL,
  `deleted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_table_record` (`table_name`,`record_id`),
  KEY `idx_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `tax_rates` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `rate` decimal(5,2) NOT NULL,
  `description` text,
  `is_default` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `transaction_references` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sales_order` varchar(50) DEFAULT NULL,
  `purchase_order` varchar(50) DEFAULT NULL,
  `sales_delivery` varchar(50) DEFAULT NULL,
  `payment_to_supplier` varchar(50) DEFAULT NULL,
  `sales_invoice` varchar(50) DEFAULT NULL,
  `customer_payment` varchar(50) DEFAULT NULL,
  `delivery_receipt` varchar(50) DEFAULT NULL,
  `stock_adjustment` varchar(50) DEFAULT NULL,
  `sales_hold` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `receipt_number` varchar(100) DEFAULT '00000001',
  `si_number` varchar(50) DEFAULT '000000',
  `si_prefix` varchar(8) DEFAULT NULL,
  `mc_number` varchar(20) NOT NULL DEFAULT '000000',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `units_of_measure` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `abbreviation` varchar(10) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_activity_logs` (
  `id` varchar(36) NOT NULL,
  `user_uid` varchar(255) NOT NULL,
  `user_name` varchar(255) NOT NULL,
  `action` varchar(100) NOT NULL,
  `module` varchar(100) NOT NULL,
  `description` text NOT NULL,
  `reference_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_uid` (`user_uid`),
  KEY `idx_module` (`module`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_permissions` (
  `id` varchar(50) NOT NULL,
  `user_uid` varchar(255) NOT NULL,
  `permission` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_permission` (`user_uid`,`permission`),
  KEY `idx_user_uid` (`user_uid`),
  KEY `idx_permission` (`permission`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_type_permissions` (
  `id` varchar(50) NOT NULL,
  `user_type_id` varchar(50) NOT NULL,
  `permission` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_type_permission` (`user_type_id`,`permission`),
  KEY `idx_user_type_id` (`user_type_id`),
  CONSTRAINT `user_type_permissions_ibfk_1` FOREIGN KEY (`user_type_id`) REFERENCES `user_types` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `user_types` (
  `id` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `users` (
  `uid` varchar(255) NOT NULL,
  `username` varchar(100) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `photo_url` varchar(500) DEFAULT NULL,
  `disabled` tinyint(1) DEFAULT '0',
  `creation_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `password` varchar(255) NOT NULL,
  `user_type` varchar(50) DEFAULT 'User',
  PRIMARY KEY (`uid`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_username` (`username`),
  KEY `idx_disabled` (`disabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `warehouses` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) NOT NULL,
  `location` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `contact_number` varchar(100) DEFAULT NULL,
  `active` tinyint(1) DEFAULT '1',
  `is_main` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `x_readings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reading_number` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `report_date` datetime NOT NULL,
  `shift_start` datetime DEFAULT NULL,
  `shift_end` datetime DEFAULT NULL,
  `terminal_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cashier_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cashier_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gross_sales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `returns` decimal(15,2) NOT NULL DEFAULT '0.00',
  `discounts` decimal(15,2) NOT NULL DEFAULT '0.00',
  `net_sales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vat_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `payment_methods` json DEFAULT NULL,
  `transaction_count` int NOT NULL DEFAULT '0',
  `starting_cash` decimal(15,2) NOT NULL DEFAULT '0.00',
  `cash_sales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `cash_in_drawer` decimal(15,2) NOT NULL DEFAULT '0.00',
  `shift_status` enum('active','completed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `min_sale_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_sale_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `void_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `refund_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `previous_reading` decimal(15,2) NOT NULL DEFAULT '0.00',
  `running_total` decimal(15,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `reading_number` (`reading_number`),
  KEY `idx_report_date` (`report_date`),
  KEY `idx_shift_start` (`shift_start`),
  KEY `idx_shift_end` (`shift_end`),
  KEY `idx_terminal_id` (`terminal_id`),
  KEY `idx_cashier_id` (`cashier_id`),
  KEY `idx_shift_status` (`shift_status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `z_readings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reading_number` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `report_date` datetime NOT NULL,
  `terminal_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `cashier_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gross_sales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `returns` decimal(15,2) NOT NULL DEFAULT '0.00',
  `discounts` decimal(15,2) NOT NULL DEFAULT '0.00',
  `net_sales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vat_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `payment_methods` json DEFAULT NULL,
  `transaction_count` int NOT NULL DEFAULT '0',
  `min_sale_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_sale_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `min_void_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_void_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `min_return_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_return_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `starting_cash` decimal(15,2) NOT NULL DEFAULT '0.00',
  `cash_sales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `cash_in_drawer` decimal(15,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `z_counter` int DEFAULT '0',
  `reset_counter` int DEFAULT '0',
  `vat_sales` decimal(15,2) NOT NULL DEFAULT '0.00',
  `vat_exempt` decimal(15,2) NOT NULL DEFAULT '0.00',
  `zero_rated` decimal(15,2) NOT NULL DEFAULT '0.00',
  `non_vat` decimal(15,2) NOT NULL DEFAULT '0.00',
  `previous_reading` decimal(15,2) NOT NULL DEFAULT '0.00',
  `running_total` decimal(15,2) NOT NULL DEFAULT '0.00',
  `discount_summary` json DEFAULT NULL,
  `sales_adjustment` json DEFAULT NULL,
  `vat_adjustment` decimal(15,2) DEFAULT '0.00',
  `vatable_sales` decimal(15,2) DEFAULT '0.00',
  `void_amount` decimal(15,2) DEFAULT '0.00',
  `actual_cash` decimal(15,2) DEFAULT '0.00',
  `cash_difference` decimal(15,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `reading_number` (`reading_number`),
  KEY `idx_report_date` (`report_date`),
  KEY `idx_terminal_id` (`terminal_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;



/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

LOCK TABLES `accounts` WRITE;
/*!40000 ALTER TABLE `accounts` DISABLE KEYS */;
INSERT  IGNORE INTO `accounts` VALUES ('account_1765251132577','SALES REVENUE','expense','4000','2025-12-09 03:32:12','2025-12-29 03:11:57'),('account_1765251163219','test','income','3000','2025-12-09 03:32:43','2026-02-13 08:59:11'),('account_1766975376027','General Sales','income','5000','2025-12-29 02:29:36','2025-12-29 02:29:36'),('account_1766975401622','General Product Purchased','expense','6000','2025-12-29 02:30:01','2025-12-29 02:30:01'),('account_1766975829472','FREIGHT COLLECTED','expense','8989','2025-12-29 02:37:09','2025-12-29 02:38:10'),('account_1766975873773','FREIGHT PAID','income','7851','2025-12-29 02:37:53','2025-12-29 03:11:42');
/*!40000 ALTER TABLE `accounts` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `approval_workflows` WRITE;
/*!40000 ALTER TABLE `approval_workflows` DISABLE KEYS */;
/*!40000 ALTER TABLE `approval_workflows` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `brands` WRITE;
/*!40000 ALTER TABLE `brands` DISABLE KEYS */;
INSERT  IGNORE INTO `brands` VALUES ('brand_1784612287063','TEST','2026-07-21 05:38:07',NULL),('brand_1784792653118','N/A','2026-07-23 07:44:13',NULL);
/*!40000 ALTER TABLE `brands` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT  IGNORE INTO `categories` VALUES ('cat_1784612296872','TEST','2026-07-21 05:38:16',NULL),('cat_1784792668307','N/A','2026-07-23 07:44:28',NULL);
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `conversion_factors` WRITE;
/*!40000 ALTER TABLE `conversion_factors` DISABLE KEYS */;
/*!40000 ALTER TABLE `conversion_factors` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `departments` WRITE;
/*!40000 ALTER TABLE `departments` DISABLE KEYS */;
INSERT  IGNORE INTO `departments` VALUES ('dept_1784612312608','TEST',NULL,'2026-07-21 05:38:32','2026-07-21 05:38:32'),('dept_1784792679312','N/A',NULL,'2026-07-23 07:44:39','2026-07-23 07:44:39');
/*!40000 ALTER TABLE `departments` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `loyalty_points_settings` WRITE;
/*!40000 ALTER TABLE `loyalty_points_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `loyalty_points_settings` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `migrations` WRITE;
/*!40000 ALTER TABLE `migrations` DISABLE KEYS */;
INSERT  IGNORE INTO `migrations` VALUES (1,'001_initial_schema','2025-01-24_09-22-00','2025-11-26 06:57:59'),(2,'014_alter_customers_table_add_fields','2025-12-10_16-17-00','2025-12-10 08:36:47'),(3,'002_drop_conversion_factor_from_units_of_measure','2025-11-26_13-22-00','2025-12-17 08:47:02'),(4,'003_create_conversion_factors_table','2025-11-26_13-40-00','2025-12-17 08:47:02'),(5,'004_alter_conversion_factors_id_length','2025-11-26_14-46-00','2025-12-17 08:47:02'),(6,'005_remove_is_serialized_from_products','2025-26-11_17-22-00','2025-12-17 08:47:20'),(7,'006_create_suppliers_table','2025-11-27_08-45-00','2025-12-17 08:47:41'),(8,'007_alter_suppliers_table_add_fields','2025-11-27_10-48-00','2025-12-17 08:48:03'),(9,'008_create_stock_adjustments_table','2025-12-04_16-20-00','2025-12-17 08:48:03'),(10,'009_add_account_foreign_keys_to_products','2025-12-09_11-30-00','2025-12-17 08:48:24'),(11,'010_create_stock_movements_table','2025-12-09_14-30-00','2025-12-17 08:48:24'),(12,'011_create_sales_transactions_tables','2025-12-09_17-54-00','2025-12-17 08:48:24'),(13,'012_create_pos_tables','2025-12-10_10-05-00','2025-12-17 08:48:24'),(14,'013_create_sales_orders_table','2025-12-10_11-00-00','2025-12-17 08:48:24'),(15,'015_alter_sales_orders_add_new_fields','2025-12-10_17-03-00','2025-12-17 08:48:44'),(16,'016_alter_customers_table_add_sales_fields','2025-12-12_10-15-00','2025-12-17 08:48:44'),(17,'017_create_loyalty_points_settings_table','2025-12-15_09-03-00','2025-12-17 08:48:44'),(18,'018_create_customer_loyalty_table','2025-12-15_09-22-00','2025-12-17 08:48:44'),(19,'019_create_point_history_table','2025-12-15_15-55-00','2025-12-17 08:48:44'),(20,'020_create_customer_payments_table','2025-12-16_11-50-00','2025-12-17 08:48:45'),(21,'021_create_sales_invoices_table','2025-12-17_16-02-43','2025-12-17 08:48:45'),(22,'022_create_warehouses_table','022','2025-12-18 01:16:51'),(23,'023_add_warehouse_foreign_key_to_products','023','2025-12-18 03:00:43'),(24,'024_alter_sales_invoices_add_sales_person','2025-12-20_08-45-00','2025-12-20 00:45:35'),(25,'025_add_sales_person_foreign_keys','2025-12-20_08-46-00','2025-12-20 00:45:35'),(26,'026_update_warehouse_foreign_key_constraint','026','2025-12-22 03:13:27'),(27,'027_create_purchase_orders_table','2025-12-22_13-55-00','2026-01-05 11:26:36'),(28,'028_drop_account_foreign_keys_from_products','2025-01-05_19-30-00','2026-01-05 11:26:37'),(29,'029_create_user_permissions_table','2025-12-29_12-00-00','2026-01-07 01:15:44'),(30,'030_create_users_table','2025-12-30_12-00-00','2026-01-07 01:16:39'),(31,'031_alter_users_table_remove_email','2025-12-31_12-00-00','2026-01-07 01:26:08'),(32,'032_add_password_to_users_table','2026-01-07_10-00-00','2026-01-13 07:49:43'),(33,'033_alter_loyalty_base_column','2026-01-13_15-55-00','2026-01-13 07:49:43'),(34,'034_create_payment_details_tables','2026-01-15_12-00-00','2026-01-15 05:55:16'),(35,'035_create_pos_settings_table','2026-01-15_15-27-00','2026-01-16 09:43:06'),(36,'036_create_supplier_product_mapping','2026-01-16_09-43-06','2026-01-16 09:43:06'),(37,'037_alter_pos_settings_add_contact_fields','2026-01-17_11-46-00','2026-01-17 03:46:36'),(38,'038_create_supplier_payments_table','2026-01-17_12-35-00','2026-01-17 05:48:52'),(39,'039_alter_suppliers_add_details','2026-01-17_13-05-00','2026-01-17 05:48:53'),(40,'040_alter_products_add_vat_and_availability','2026-01-23_08-50-00','2026-01-23 00:56:34'),(41,'042_alter_purchase_order_items_new_fields','2026-01-23_10-20-00','2026-01-23 02:27:11'),(42,'043_alter_purchase_orders_add_tracking_fields','2026-01-23_10-35-00','2026-01-23 02:36:26'),(43,'044_alter_purchase_orders_add_reference_number','2026-01-23_11-12-00','2026-01-23 03:12:08'),(44,'045_add_tax_rates','2026-01-23_13-41-00','2026-01-23 05:43:54'),(45,'046_add_markup_percentage_to_categories_brands','2026-01-24_15-52-00','2026-01-24 07:52:52'),(46,'047_alter_sales_transactions_add_voided_status','2026-01-29_08-23-00','2026-01-29 00:24:28'),(47,'016_update_sales_orders_status_enum','2026-01-30_17-05-00','2026-01-30 09:07:07'),(48,'048_alter_pos_settings_add_return_auth','2026-02-02_09-45-00','2026-02-02 01:46:15'),(49,'049_alter_pos_settings_add_recent_sales_auth','2026-02-02_10-50-00','2026-02-02 02:44:22'),(50,'040_add_unique_constraint_conversion_factors','2026-02-05_18-00-00','2026-02-05 10:06:18'),(51,'050_create_bad_orders_table','2026-02-10_15-50-00','2026-02-10 07:54:10'),(52,'051_create_cash_transfers_table','2026-02-11_09-20-00','2026-02-11 01:13:58'),(53,'052_add_expiration_date_fields','2026-02-13_08-40-00','2026-02-13 00:39:22'),(54,'053_alter_payment_methods_add_require_reference','2026-02-13_13-30-00','2026-02-13 05:33:57'),(55,'040_add_show_quantity_to_pos_settings','2026-02-16_10-10-11','2026-02-16 02:14:40'),(56,'054_add_payment_reference_to_sales_tables','2026-02-21_09-30-00','2026-02-21 01:29:22'),(57,'055_add_partially_paid_status','2026-03-04_10-45-00','2026-03-04 02:48:39'),(58,'056_update_product_sku_index','2026-03-10_13-55-00','2026-03-10 05:53:21'),(59,'057_create_stock_counts_tables','2026-03-11_07-55-00','2026-03-10 23:56:48'),(60,'058_create_shelf_locations_table','058','2026-03-11 00:58:40'),(61,'059_add_locations_to_stock_counts','2026-03-11_08-20-00','2026-03-11 06:08:16'),(62,'060_alter_loyalty_points_precision','2026-03-17_10-10-00','2026-03-17 02:17:17'),(63,'061_add_bir_compliance_columns','2026-03-17_16-20-00','2026-03-17 08:22:16'),(64,'062_add_counters_to_z_readings','2026-03-17_16-30-00','2026-03-17 08:30:50'),(65,'063_add_is_training_to_pos_transactions','2026-03-17_16-35-00','2026-03-17 08:33:06'),(66,'064_add_is_training_to_all_sales_tables','2026-03-17_17-00-00','2026-03-17 08:41:18'),(67,'065_create_departments_table','2026-04-13_08-00-00','2026-04-12 23:59:41'),(68,'066_create_product_shelves_table','066','2026-04-13 02:05:45'),(69,'067_add_quantity_to_product_shelves','067','2026-04-13 03:39:53'),(70,'068_update_stock_movements_reference_type','2026-04-13_11-45-00','2026-04-13 03:49:16'),(71,'070_create_user_types_tables','2026-04-13_13-15-00','2026-04-13 05:15:06'),(72,'071_create_repackaging_logs_table','2026-04-16_07-00-00','2026-04-16 07:13:52'),(73,'072_add_repackaging_approval_setting','2026-04-16_07-10-00','2026-04-16 07:14:33'),(74,'073_alter_stock_adjustments_add_metadata_fields','2026-04-17_10-10-00','2026-04-17 02:10:44'),(75,'074_create_inventory_transfers_table','2026-04-17_11-46-00','2026-04-17 03:46:23'),(76,'075_add_warehouse_id_to_stock_movements','2026-04-17_13-12-00','2026-04-17 05:12:01'),(77,'076_add_warehouse_to_purchase_orders','2026-04-23_10-40-00','2026-04-23 02:37:35'),(78,'077_add_subtotal_to_purchase_order_items','2026-04-23_11-00-00','2026-04-23 02:57:22'),(79,'078_alter_stock_precision','078','2026-05-06 07:42:26'),(80,'079_create_payment_allocations_table','2026-06-02_00-00-00','2026-06-02 03:50:12'),(81,'080_backfill_payment_allocations','2026-06-02_00-10-00','2026-06-02 05:44:36'),(82,'081_normalize_payment_invoice_notes','2026-06-02_00-20-00','2026-06-02 05:48:35'),(83,'082_alter_pos_settings_add_vat_registration','2026-06-06_10-00-00','2026-06-06 01:22:14'),(84,'083_add_si_number_to_tables','2026-06-23_10-00-00','2026-06-23 01:26:01'),(85,'084_add_si_number_to_transaction_references','2026-06-23_10-05-00','2026-06-23 01:26:01'),(86,'085_backfill_si_numbers','2026-06-23_10-10-00','2026-06-23 01:26:01'),(87,'086_redesign_sales_order_flow','2026-06-23_12-00-00','2026-06-23 04:05:27'),(88,'087_add_due_date_to_purchase_orders','2026-06-25','2026-06-25 02:56:02'),(89,'088_create_supplier_credit_memos_table','2026-06-25','2026-06-25 02:56:02'),(90,'089_seed_default_units_of_measure','2026-06-30_00-00-00','2026-06-30 03:32:33'),(91,'090_create_sync_tombstones_table','2026-06-30','2026-07-02 04:34:20'),(92,'091_add_si_prefix_to_transaction_references','2026-07-06_12-00-00','2026-07-06 08:49:06'),(93,'092_create_stock_movement_applied_table','2026-07-06_13-00-00','2026-07-08 02:16:56'),(94,'093_backfill_stock_movement_applied','2026-07-06_13-30-00','2026-07-08 02:41:47'),(95,'094_create_sync_conflicts_table','2026-07-06_14-00-00','2026-07-08 09:31:21'),(96,'095_dedupe_external_api_logs','2026-07-10_12-00-00','2026-07-10 07:15:56'),(97,'096_create_membership_payments','2026-07-13_10-00-00','2026-07-13 10:42:35'),(98,'097_add_product_approval_setting','2026-07-14_09-00-00','2026-07-14 03:46:53'),(99,'098_fix_si_number_initial_value','2026-07-21_09-00-00','2026-07-22 00:48:40'),(100,'099_add_mc_number','2026-07-22_10-00-00','2026-07-22 00:48:40'),(102,'100_add_expiration_tracking','2026-07-22_12-00-00','2026-07-22 02:05:36'),(104,'101_add_product_type','2026-07-23_10-00-00','2026-07-23 05:59:11'),(105,'102_unique_sales_order_reference','2026-07-23_16-00-00','2026-07-23 09:46:18');
/*!40000 ALTER TABLE `migrations` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `payment_methods` WRITE;
/*!40000 ALTER TABLE `payment_methods` DISABLE KEYS */;
INSERT  IGNORE INTO `payment_methods` VALUES ('pm_bank_transfer','Bank Transfer',1,'2026-07-21 05:37:03',0,NULL,NULL),('pm_cash','Cash',1,'2026-07-21 05:37:03',0,NULL,NULL),('pm_check','Check',1,'2026-07-21 05:37:03',0,NULL,NULL),('pm_credit_card','Credit Card',1,'2026-07-21 05:37:03',0,NULL,NULL),('pm_gcash','GCash',1,'2026-07-21 05:37:03',0,NULL,NULL),('pm_paypal','PayPal',1,'2026-07-21 05:37:03',0,NULL,NULL);
/*!40000 ALTER TABLE `payment_methods` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `payment_term_types` WRITE;
/*!40000 ALTER TABLE `payment_term_types` DISABLE KEYS */;
INSERT  IGNORE INTO `payment_term_types` VALUES ('ptt_1784682204766_2p4i0xmu9','Cash',1,'2026-07-22 01:03:24','2026-07-22 01:03:24'),('ptt_1784682204782_sdujghd63','Credit',1,'2026-07-22 01:03:24','2026-07-22 01:03:24'),('ptt_1784682204789_3lia22xk2','Net 30',1,'2026-07-22 01:03:24','2026-07-22 01:03:24'),('ptt_1784682204792_7go8i8egr','Net 60',1,'2026-07-22 01:03:24','2026-07-22 01:03:24'),('ptt_1784682204796_o7l4q295q','COD',1,'2026-07-22 01:03:24','2026-07-22 01:03:24');
/*!40000 ALTER TABLE `payment_term_types` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `payment_terms` WRITE;
/*!40000 ALTER TABLE `payment_terms` DISABLE KEYS */;
/*!40000 ALTER TABLE `payment_terms` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `pos_queue_counter` WRITE;
/*!40000 ALTER TABLE `pos_queue_counter` DISABLE KEYS */;
INSERT  IGNORE INTO `pos_queue_counter` VALUES (1,1,999,1,'2026-06-26 02:25:32','2026-06-26');
/*!40000 ALTER TABLE `pos_queue_counter` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `pos_settings` WRITE;
/*!40000 ALTER TABLE `pos_settings` DISABLE KEYS */;
INSERT  IGNORE INTO `pos_settings` VALUES ('pos_settings_1','My Business',NULL,0,'TXN','2026-07-21 05:37:03','2026-07-22 06:33:01',NULL,NULL,NULL,NULL,'₱','PHP','Asia/Manila','MM/DD/YYYY',1,0.00,'[\"subcategory\", \"category\", \"brand\", \"supplier\"]',0,NULL,NULL,0,NULL,NULL,0,NULL,NULL,'58mm','browser',0,0,NULL,NULL,0,NULL,NULL,0,0,NULL,NULL,NULL,NULL,NULL,10,0,NULL,1,0,NULL,0,NULL,NULL,1,0,'XP-58-P',0,0,0,0,0,0,0,1,0,0,0,NULL,NULL,0,'Welcome! Thank you for shopping.',1,'VAT',NULL,0,NULL,NULL,'default',0,NULL,NULL,0,NULL,NULL,0,NULL,NULL,0.00,12,0);
/*!40000 ALTER TABLE `pos_settings` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `pos_terminals` WRITE;
/*!40000 ALTER TABLE `pos_terminals` DISABLE KEYS */;
INSERT  IGNORE INTO `pos_terminals` VALUES ('terminal_1784612256369','COUNTER 1','wh_main','127.0.0.1',1,'2026-07-21 05:37:36','2026-07-23 05:06:41',0,NULL,NULL,NULL,'No','000010','2026-07-23 05:06:41',0,0,NULL,NULL);
/*!40000 ALTER TABLE `pos_terminals` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `price_levels` WRITE;
/*!40000 ALTER TABLE `price_levels` DISABLE KEYS */;
INSERT  IGNORE INTO `price_levels` VALUES ('retail-level','Retail','retail','Standard retail price',1,'2026-07-21 05:37:03','2026-07-21 05:37:03',100.00,0);
/*!40000 ALTER TABLE `price_levels` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `sales_areas` WRITE;
/*!40000 ALTER TABLE `sales_areas` DISABLE KEYS */;
INSERT  IGNORE INTO `sales_areas` VALUES ('area_1','North','Northern Region',1,'2026-01-13 09:03:11','2026-01-13 09:03:11'),('area_1768295964695','sales',NULL,1,'2026-01-13 09:19:24','2026-01-13 09:19:24'),('area_2','South','Southern Region',1,'2026-01-13 09:03:11','2026-01-13 09:03:11');
/*!40000 ALTER TABLE `sales_areas` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `sales_groups` WRITE;
/*!40000 ALTER TABLE `sales_groups` DISABLE KEYS */;
INSERT  IGNORE INTO `sales_groups` VALUES ('group_1','Group A','High Value Customers',1,'2026-01-13 09:15:02','2026-01-13 09:15:02'),('group_2','Group B','Regular Customers',1,'2026-01-13 09:15:02','2026-01-13 09:15:02'),('group_3','Group C','New Customers',1,'2026-01-13 09:15:02','2026-01-13 09:15:02');
/*!40000 ALTER TABLE `sales_groups` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `sales_persons` WRITE;
/*!40000 ALTER TABLE `sales_persons` DISABLE KEYS */;
INSERT  IGNORE INTO `sales_persons` VALUES ('sp_1','John Doe','+1-555-0101',1,'2026-07-23 09:19:46','2026-07-23 09:19:46'),('sp_1784798386433','rex',NULL,1,'2026-07-23 09:19:46','2026-07-23 09:19:46'),('sp_2','Jane Smith','+1-555-0102',1,'2026-07-23 09:19:46','2026-07-23 09:19:46'),('sp_3','Mike Johnson','+1-555-0103',1,'2026-07-23 09:19:46','2026-07-23 09:19:46'),('sp_4','Sarah Wilson','+1-555-0104',1,'2026-07-23 09:19:46','2026-07-23 09:19:46');
/*!40000 ALTER TABLE `sales_persons` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `shelf_locations` WRITE;
/*!40000 ALTER TABLE `shelf_locations` DISABLE KEYS */;
INSERT  IGNORE INTO `shelf_locations` VALUES ('shelf_1784612326844','A1',NULL,1,'2026-07-21 05:38:46','2026-07-21 05:38:46');
/*!40000 ALTER TABLE `shelf_locations` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `tax_rates` WRITE;
/*!40000 ALTER TABLE `tax_rates` DISABLE KEYS */;
INSERT  IGNORE INTO `tax_rates` VALUES ('90161113-306a-4619-beea-937ae01b41ab','NO (ZERO RATED)',0.00,'',0,'2026-04-10 02:15:43','2026-04-10 02:15:43'),('b0364920-7ba2-4a58-901b-736a528fc9c2','CUSTOME VAT ',12.00,'',0,'2026-04-10 02:16:15','2026-05-06 09:37:11'),('d5f9cb9d-f228-48ec-bb8f-2ac906decec3','YES (Subject to 12% VAT)',12.00,'',0,'2026-01-23 05:47:10','2026-04-10 02:14:49'),('ff2b20f7-6fbd-476f-8d1a-15827f84aee3','NO (VAT EXEMPT)',0.00,'',0,'2026-04-10 02:15:27','2026-04-10 02:15:27');
/*!40000 ALTER TABLE `tax_rates` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `transaction_references` WRITE;
/*!40000 ALTER TABLE `transaction_references` DISABLE KEYS */;
INSERT  IGNORE INTO `transaction_references` VALUES (1,'1005','1000','1000','1000','1015','1000','1000','1000','1000','2026-07-21 05:37:03','2026-07-23 10:27:10','000007','000009',NULL,'000002');
/*!40000 ALTER TABLE `transaction_references` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `units_of_measure` WRITE;
/*!40000 ALTER TABLE `units_of_measure` DISABLE KEYS */;
INSERT  IGNORE INTO `units_of_measure` VALUES ('uom_seed_bottle','Bottle','btl','2026-07-21 05:37:03'),('uom_seed_box','Box','box','2026-07-21 05:37:03'),('uom_seed_bundle','Bundle','bdl','2026-07-21 05:37:03'),('uom_seed_can','Can','can','2026-07-21 05:37:03'),('uom_seed_case','Case','cs','2026-07-21 05:37:03'),('uom_seed_dozen','Dozen','dz','2026-07-21 05:37:03'),('uom_seed_gram','Gram','g','2026-07-21 05:37:03'),('uom_seed_kilogram','Kilogram','kg','2026-07-21 05:37:03'),('uom_seed_liter','Liter','L','2026-07-21 05:37:03'),('uom_seed_meter','Meter','m','2026-07-21 05:37:03'),('uom_seed_milliliter','Milliliter','mL','2026-07-21 05:37:03'),('uom_seed_pack','Pack','pck','2026-07-21 05:37:03'),('uom_seed_pair','Pair','pr','2026-07-21 05:37:03'),('uom_seed_piece','Piece','pc','2026-07-21 05:37:03'),('uom_seed_ream','Ream','rm','2026-07-21 05:37:03'),('uom_seed_roll','Roll','roll','2026-07-21 05:37:03'),('uom_seed_sack','Sack','sack','2026-07-21 05:37:03'),('uom_seed_set','Set','set','2026-07-21 05:37:03');
/*!40000 ALTER TABLE `units_of_measure` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `user_permissions` WRITE;
/*!40000 ALTER TABLE `user_permissions` DISABLE KEYS */;
INSERT  IGNORE INTO `user_permissions` VALUES ('086bd342-28ed-4c01-95fb-f31e1ab7f99c','mock-admin-01','view_approvals','2026-04-26 14:47:29','2026-04-26 14:47:29'),('1c4495ae-8311-4418-8e64-61cd33fbf43d','mock-admin-01','manage_approval_settings','2026-04-26 14:47:29','2026-04-26 14:47:29'),('24dd6832-2ada-4fd2-97fc-cdb6fef0a08e','mock-admin-01','manage_customers','2026-04-26 14:47:29','2026-04-26 14:47:29'),('25d4658d-0c32-4b47-b24c-4ab95a7728ef','mock-admin-01','manage_users','2026-04-26 14:47:29','2026-04-26 14:47:29'),('265ae796-a00d-406f-a3f9-e9db158b434f','mock-admin-01','manage_settings','2026-04-26 14:47:29','2026-04-26 14:47:29'),('2b37e714-dcd6-4df6-b520-032e63ab0288','mock-admin-01','manage_inventory','2026-04-26 14:47:29','2026-04-26 14:47:29'),('38e79622-da76-4d67-829a-23d4c6442a3b','mock-admin-01','view_dashboard','2026-04-26 14:47:29','2026-04-26 14:47:29'),('4a8724cc-ab9f-4c6f-84aa-f480891e7413','mock-admin-01','view_sales','2026-04-26 14:47:29','2026-04-26 14:47:29'),('5a9e4e27-99c6-4b49-b82f-4c24a79eb7fc','mock-admin-01','manage_suppliers','2026-04-26 14:47:29','2026-04-26 14:47:29'),('738d70c4-0416-4671-9860-1badcf02176f','mock-admin-01','view_reports','2026-04-26 14:47:29','2026-04-26 14:47:29'),('73d7523e-a2a3-465a-a794-8ea34d0f2920','mock-admin-01','manage_products','2026-04-26 14:47:29','2026-04-26 14:47:29'),('8da5769f-220c-4d2f-b4e6-e4bbade56a4d','mock-admin-01','access_pos','2026-04-26 14:47:29','2026-04-26 14:47:29'),('ff36528d-1a61-41ce-9bcd-04d2e9fc91b0','mock-admin-01','manage_purchases','2026-04-26 14:47:29','2026-04-26 14:47:29');
/*!40000 ALTER TABLE `user_permissions` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `user_type_permissions` WRITE;
/*!40000 ALTER TABLE `user_type_permissions` DISABLE KEYS */;
INSERT  IGNORE INTO `user_type_permissions` VALUES ('00332260-99d5-400a-84e1-777476ec6703','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_suppliers','2026-04-13 05:15:06'),('00a083dd-95bb-4930-aa71-c055fc01798c','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','view_approvals','2026-04-27 06:42:59'),('0170b9ed-8da4-456f-bb26-1adba8dc55e9','bbe783bf-0fec-4a87-8a6a-8a633ade288e','view_approvals','2026-04-14 05:56:36'),('075e35c8-9fb1-4f14-97ef-4be9c9931ad9','2ace63d8-b543-4303-903e-44db2fd8558a','view_sales','2026-04-13 05:15:06'),('07898b7e-e296-40e6-9927-8a7826b36775','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','manage_inventory','2026-04-13 05:15:06'),('0986e342-36a8-4f4c-9b49-9fc0e59eeffc','25a22eda-3703-11f1-8003-f4b5207563ca','view_dashboard','2026-04-13 17:57:21'),('109b0bae-e77b-466d-8f15-eaa971e8f809','25a0e78e-3703-11f1-8003-f4b5207563ca','view_approvals','2026-04-13 00:34:08'),('14cc66eb-c6e5-4d64-a3b7-14c939b57bb1','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','manage_products','2026-04-12 21:15:06'),('167d9cd9-e089-4f74-8400-6e0e45cbad3c','25a0e78e-3703-11f1-8003-f4b5207563ca','manage_products','2026-04-13 00:34:08'),('19e79ceb-d1b0-4ddd-8c65-623cad1b2c89','25a312d3-3703-11f1-8003-f4b5207563ca','view_approvals','2026-04-13 17:57:32'),('1b154ec2-2a95-463e-ac59-800de1c84805','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','view_dashboard','2026-04-12 21:15:06'),('1c18f842-1763-4664-9d9a-380ac85a0c99','2ace63d8-b543-4303-903e-44db2fd8558a','manage_customers','2026-04-12 21:15:06'),('1dad857a-85c0-487b-8ef7-9b71bb66f88d','25a312d3-3703-11f1-8003-f4b5207563ca','manage_customers','2026-04-13 17:57:32'),('225bcd20-92b5-4b22-814a-f773f1092130','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_purchases','2026-04-12 21:15:06'),('3172f0c2-1993-4ee6-9ec0-e9a5b403743c','bbe783bf-0fec-4a87-8a6a-8a633ade288e','manage_purchases','2026-04-13 21:56:36'),('36fa4434-8df1-4af6-8d13-9f08ce77ff9e','2ace63d8-b543-4303-903e-44db2fd8558a','view_reports','2026-04-12 21:15:06'),('3f37ba3f-71dd-47ae-9456-e19c34f7b2da','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_inventory','2026-04-12 21:15:06'),('52a302ab-360a-4478-b66e-4bde44dbe72e','2ace63d8-b543-4303-903e-44db2fd8558a','manage_inventory','2026-04-12 21:15:06'),('6b828014-32e6-4b29-962d-3dd19fcd09ca','25a312d3-3703-11f1-8003-f4b5207563ca','manage_inventory','2026-04-13 17:57:32'),('6ea13128-0544-49e6-8cf3-182257001773','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_settings','2026-04-12 21:15:06'),('6f03263b-f0a6-41b2-8e5f-17acdb685e1a','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_products','2026-04-12 21:15:06'),('6f5046fc-d256-4890-81fb-57782dd47495','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','view_reports','2026-04-12 21:15:06'),('746c3928-9114-48bd-b368-327e33b2ea44','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_customers','2026-04-12 21:15:06'),('82fd6dff-cc4d-4d4b-adf3-bc7229a9dd05','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','access_pos','2026-04-12 21:15:06'),('83830cf5-045b-4dbd-beb6-eea7d642988a','25a22eda-3703-11f1-8003-f4b5207563ca','manage_inventory','2026-04-13 17:57:21'),('83e99f3a-c001-40d0-9092-75f49487daa7','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_users','2026-04-12 21:15:06'),('88ea4048-6649-48aa-bb0b-1a26d9720126','25a22eda-3703-11f1-8003-f4b5207563ca','manage_purchases','2026-04-13 17:57:21'),('8aa4a836-aa9f-4f23-9a00-994fe7baad60','2ace63d8-b543-4303-903e-44db2fd8558a','manage_products','2026-04-12 21:15:06'),('9ab838b8-42d7-4d3f-9d40-07d6a1b7bd88','25a312d3-3703-11f1-8003-f4b5207563ca','manage_suppliers','2026-04-13 17:57:32'),('9b769bd7-d3e7-46f4-9a67-0888e994248b','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','manage_suppliers','2026-04-12 21:15:06'),('9fa962cc-4ad8-4fb8-80a4-b2cb07055c2a','2ace63d8-b543-4303-903e-44db2fd8558a','manage_suppliers','2026-04-12 21:15:06'),('a189fb8e-84ed-4380-97e1-2e1e9fcbf999','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','view_dashboard','2026-04-12 21:15:06'),('a3aca718-681a-4f42-bbe1-1e8607b8fb1d','bbe783bf-0fec-4a87-8a6a-8a633ade288e','manage_inventory','2026-04-13 21:56:36'),('a3c75bae-c461-4528-9ee1-383e615ee1f1','25a312d3-3703-11f1-8003-f4b5207563ca','manage_purchases','2026-04-13 17:57:32'),('a44abe78-2b13-4ee1-9ece-27e25b36da34','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','view_reports','2026-04-12 21:15:06'),('a7594e5c-4131-4314-82ba-5368a4e020ce','9ab28501-508b-4b9e-b1b7-e494c8b23084','access_pos','2026-04-12 21:15:06'),('af66fa90-5051-47b8-8eee-c3c77105d510','c9f942af-6234-42fe-a17a-82c101cc1418','view_dashboard','2026-04-12 21:15:06'),('b89ce695-d6d0-4997-bb57-1134a9a192e8','25a0e78e-3703-11f1-8003-f4b5207563ca','manage_approval_settings','2026-04-13 00:34:08'),('bf1aacc8-d696-4d1d-a7fb-feb961344931','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','manage_customers','2026-04-12 21:15:06'),('c7301d62-5d31-4a7b-b614-137620c1a62e','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','manage_approval_settings','2026-04-27 06:42:59'),('c8c9a45f-f108-4f2f-af71-09d6a59069a4','25a0e78e-3703-11f1-8003-f4b5207563ca','manage_purchases','2026-04-13 00:34:08'),('d8b4c5fd-ed8e-41e3-aa0f-c81c2a5c5682','bbe783bf-0fec-4a87-8a6a-8a633ade288e','view_dashboard','2026-04-13 21:56:36'),('db8de4b9-136a-4f5f-b3c1-501ee10ecd19','25a22eda-3703-11f1-8003-f4b5207563ca','view_approvals','2026-04-13 17:57:21'),('de36d04c-c3c6-4df7-8e09-9fdebf473a73','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','view_sales','2026-04-12 21:15:06'),('e4108266-cb71-4a5d-a1f7-1eb78a62d4c0','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','view_sales','2026-04-12 21:15:06'),('e45db287-345f-491d-9f68-d902e393a48e','25a0e78e-3703-11f1-8003-f4b5207563ca','manage_inventory','2026-04-13 00:34:08'),('e9e52283-56f5-4a5c-ae26-b763a1e90530','d4054cea-0f19-44e0-8965-bb1e814f3645','pos_frontliner','2026-06-25 06:55:36'),('ebcf1d83-659e-497a-8b24-0fff92845057','25a0e78e-3703-11f1-8003-f4b5207563ca','manage_suppliers','2026-04-13 00:34:08'),('f2c1ea70-705d-4762-ab56-3e8674e6c02e','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','manage_purchases','2026-04-12 21:15:06'),('f4c9722c-5584-4f8b-a875-7f35457b6417','b728a2ca-f593-4c31-a7df-ebcb4f9cc330','access_pos','2026-04-12 21:15:06'),('f4fe6bb6-22da-4697-b782-87ca4ccfd6d8','2ace63d8-b543-4303-903e-44db2fd8558a','view_dashboard','2026-04-12 21:15:06'),('f6fe5a5a-eb1f-4ed5-8694-23c41ef2d71e','2c5d827d-f4aa-4aea-81a0-ccf09db187f5','manage_users','2026-04-12 21:15:06'),('f7404394-cd75-41cf-a20d-57c0d03643cc','d4054cea-0f19-44e0-8965-bb1e814f3645','access_pos','2026-06-25 06:55:36');
/*!40000 ALTER TABLE `user_type_permissions` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `user_types` WRITE;
/*!40000 ALTER TABLE `user_types` DISABLE KEYS */;
INSERT  IGNORE INTO `user_types` VALUES ('25a0e78e-3703-11f1-8003-f4b5207563ca','Merchandise Users','System generated role for approvals','2026-04-13 06:36:48','2026-04-13 06:36:48'),('25a22eda-3703-11f1-8003-f4b5207563ca','Audit Users','System generated role for approvals','2026-04-13 06:36:48','2026-04-13 06:36:48'),('25a312d3-3703-11f1-8003-f4b5207563ca','General Manager','System generated role for approvals','2026-04-13 06:36:48','2026-04-13 06:36:48'),('2ace63d8-b543-4303-903e-44db2fd8558a','Staff','Initial Staff role','2026-04-13 05:15:06','2026-04-13 05:15:06'),('2c5d827d-f4aa-4aea-81a0-ccf09db187f5','Admin','Test Admin role','2026-07-09 05:15:41','2026-07-09 05:15:41'),('9ab28501-508b-4b9e-b1b7-e494c8b23084','Cashier','Test Cashier role','2026-07-09 05:15:41','2026-07-09 05:15:41'),('b728a2ca-f593-4c31-a7df-ebcb4f9cc330','Super Admin','Initial Super Admin role','2026-04-13 05:15:06','2026-04-13 05:15:06'),('bbe783bf-0fec-4a87-8a6a-8a633ade288e','Inventory Man','','2026-04-13 05:26:43','2026-04-13 05:26:43'),('c9f942af-6234-42fe-a17a-82c101cc1418','User','Initial User role','2026-04-13 05:15:06','2026-04-13 05:15:06'),('d4054cea-0f19-44e0-8965-bb1e814f3645','Frontliner','','2026-06-25 06:55:36','2026-06-25 06:55:36');
/*!40000 ALTER TABLE `user_types` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT  IGNORE INTO `users` VALUES ('mock-admin-01','admin','Super Admin',NULL,0,'2026-04-27 06:37:27','2026-04-27 06:37:27','2026-07-23 03:59:40','$2b$10$vZSgJOHZC8YM2Q/fHWZEMuWZ5ahmoBVAAQ0.qMLe4j2X1JS7hDMSy','Super Admin');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `warehouses` WRITE;
/*!40000 ALTER TABLE `warehouses` DISABLE KEYS */;
INSERT  IGNORE INTO `warehouses` VALUES ('wh_main','STORE','Main Store',1,'2026-07-21 05:37:03','2026-07-21 05:37:03',NULL,1,1);
/*!40000 ALTER TABLE `warehouses` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- Reference/seed data preserved from prior template (tables empty in source DB)
LOCK TABLES `approval_workflows` WRITE;
/*!40000 ALTER TABLE `approval_workflows` DISABLE KEYS */;
INSERT  IGNORE INTO `approval_workflows` VALUES ('140d42df-0a1a-4b7f-b2f2-97c8f4b7c822','REPACKAGING','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-09 06:45:39');
INSERT  IGNORE INTO `approval_workflows` VALUES ('15f5f1f2-5f68-40d0-b12d-2e5a11de68ba','STOCK_COUNT','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-09 06:36:58');
INSERT  IGNORE INTO `approval_workflows` VALUES ('18d06551-2c2e-466b-9a2b-79ac4e932acf','RECEIVE_PO','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-09 06:45:34');
INSERT  IGNORE INTO `approval_workflows` VALUES ('1affbf84-2182-41d7-b2b8-afc95c4d11cb','STOCK_TRANSFER','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-10 08:59:44');
INSERT  IGNORE INTO `approval_workflows` VALUES ('1f2ce523-3319-44c8-bc88-944d482b63d6','BAD_ORDER','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-09 06:45:37');
INSERT  IGNORE INTO `approval_workflows` VALUES ('7e43f368-6964-41f3-91de-3cf95f7a23a8','STOCK_TRANSFER','25a22eda-3703-11f1-8003-f4b5207563ca',2,'2026-07-10 08:59:44');
INSERT  IGNORE INTO `approval_workflows` VALUES ('88afe0cb-df29-4baf-9ff2-91536400936d','PRODUCT_CREATE','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-14 06:30:25');
INSERT  IGNORE INTO `approval_workflows` VALUES ('a2f93e34-d7c5-478e-8f5d-e8640b6880b4','SHELF_TRANSFER','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-08 22:39:30');
INSERT  IGNORE INTO `approval_workflows` VALUES ('a92dbe00-6983-40c8-bc42-fe9fc5409ea0','STOCK_ADJUSTMENT','bbe783bf-0fec-4a87-8a6a-8a633ade288e',3,'2026-07-10 08:56:01');
INSERT  IGNORE INTO `approval_workflows` VALUES ('d73996d3-3e28-4f83-99d8-632ed8f91896','STOCK_ADJUSTMENT','25a22eda-3703-11f1-8003-f4b5207563ca',2,'2026-07-10 08:56:01');
INSERT  IGNORE INTO `approval_workflows` VALUES ('dab22f33-2544-46f0-a67c-992347241072','STOCK_ADJUSTMENT','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-10 08:56:01');
INSERT  IGNORE INTO `approval_workflows` VALUES ('f62a7bdb-a8e9-436e-be45-e84992d586f8','PURCHASE_ORDER','2c5d827d-f4aa-4aea-81a0-ccf09db187f5',1,'2026-07-09 06:45:31');
/*!40000 ALTER TABLE `approval_workflows` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `conversion_factors` WRITE;
/*!40000 ALTER TABLE `conversion_factors` DISABLE KEYS */;
INSERT  IGNORE INTO `conversion_factors` VALUES ('BRD-TES-4B0VMW-1784010216684-cf-Case-1784020282741-hmlgfab65','BRD-TES-4B0VMW-1784010216684','Case',12.00,'2026-07-14 09:11:22');
INSERT  IGNORE INTO `conversion_factors` VALUES ('prod_1783674107067_507-cf-Piece-1784016599904-j3q7napya','prod_1783674107067_507','Piece',12.00,'2026-07-14 08:09:59');
INSERT  IGNORE INTO `conversion_factors` VALUES ('TES-SAL-Y19IVP-1783674421921-cf-Pack-1784020335508-60mwh56bv','TES-SAL-Y19IVP-1783674421921','Pack',25.00,'2026-07-14 09:12:15');
INSERT  IGNORE INTO `conversion_factors` VALUES ('TES-SAL-Y19IVP-1783674421921-cf-Piece-1784016899697-x7y3ldb6r','TES-SAL-Y19IVP-1783674421921','Piece',25.00,'2026-07-14 08:14:59');
INSERT  IGNORE INTO `conversion_factors` VALUES ('TES-TES-H05BCL-1783673044623-cf-Piece-1783673044630-ukjef1mmi','TES-TES-H05BCL-1783673044623','Piece',12.00,'2026-07-10 08:44:04');
INSERT  IGNORE INTO `conversion_factors` VALUES ('TES-TES-HV66HK-1783672694057-cf-Piece-1783672694078-4zhbeh73j','TES-TES-HV66HK-1783672694057','Piece',12.00,'2026-07-10 08:38:14');
INSERT  IGNORE INTO `conversion_factors` VALUES ('TES-TES-MVDEF0-1783578819433-cf-Piece-1784016612948-opcyaohnc','TES-TES-MVDEF0-1783578819433','Piece',12.00,'2026-07-14 08:10:12');
/*!40000 ALTER TABLE `conversion_factors` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `loyalty_points_settings` WRITE;
/*!40000 ALTER TABLE `loyalty_points_settings` DISABLE KEYS */;
INSERT  IGNORE INTO `loyalty_points_settings` VALUES ('1783675212035','GOLD MEMBERSHIP','amount',500.00,1.00,'2026-07-10 09:20:12','2026-07-10 09:20:12');
/*!40000 ALTER TABLE `loyalty_points_settings` ENABLE KEYS */;
UNLOCK TABLES;

LOCK TABLES `payment_terms` WRITE;
/*!40000 ALTER TABLE `payment_terms` DISABLE KEYS */;
INSERT  IGNORE INTO `payment_terms` VALUES ('pt_1784100224274','Net 30','Net 30','30',1,'2026-07-15 07:23:44','2026-07-15 07:23:44');
/*!40000 ALTER TABLE `payment_terms` ENABLE KEYS */;
UNLOCK TABLES;

SET FOREIGN_KEY_CHECKS=1;
