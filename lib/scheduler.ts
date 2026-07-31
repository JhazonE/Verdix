import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { performBackup } from './backup';
import { query } from './mysql';
import { getExternalApiConfig } from './external-api-config';
import {
  syncPurchaseTransaction,
  syncPaymentTransaction,
  syncSalesTransaction,
  syncAccountsPayable
} from './services/external-accounting-api';
import { sendZReadingToStaLucia, loadStaLuciaConfig } from './integrations/sta-lucia/send-z-reading';

export interface BackupSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  time: string;
  dayOfWeek?: number;
}

const SCHEDULE_FILE = path.join(process.cwd(), 'backups', 'schedule.json');
let activeJob: any = null; // Use any or find exact type if import is problematic

export function getSchedule(): BackupSchedule {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to read backup schedule:', error);
  }
  
  return {
    enabled: false,
    frequency: 'daily',
    time: '00:00'
  };
}

export function saveSchedule(schedule: BackupSchedule): void {
  try {
    const dir = path.dirname(SCHEDULE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
    console.log('Schedule saved:', schedule);
    
    // Restart the cron job with the new schedule
    startScheduledBackup(schedule);
  } catch (error) {
    console.error('Failed to save backup schedule:', error);
  }
}

export function startScheduledBackup(schedule: BackupSchedule): void {
  if (activeJob) {
    activeJob.stop();
    activeJob = null;
    console.log('Previous backup job stopped.');
  }

  if (!schedule.enabled) {
    console.log('Automated backups are disabled.');
    return;
  }

  const [hours, minutes] = schedule.time.split(':');
  let cronExpression = '';

  if (schedule.frequency === 'daily') {
    cronExpression = `${minutes} ${hours} * * *`;
  } else if (schedule.frequency === 'weekly') {
    const day = schedule.dayOfWeek !== undefined ? schedule.dayOfWeek : 0;
    cronExpression = `${minutes} ${hours} * * ${day}`;
  }

  if (cronExpression) {
    console.log(`Starting scheduled backup with cron: ${cronExpression}`);
    activeJob = cron.schedule(cronExpression, async () => {
      console.log('--- Executing Scheduled Backup ---');
      try {
        const filename = await performBackup();
        console.log(`Scheduled backup successful: ${filename}`);
      } catch (error) {
        console.error('Scheduled backup failed:', error);
      }
    });
  }
}

/** Types gated by the legacy external_api_settings config. */
const LEGACY_SYNC_TYPES = ['PURCHASE_ORDER', 'SUPPLIER_PAYMENT', 'SALES_INVOICE', 'ACCOUNTS_PAYABLE'];

/**
 * Shared success/failure bookkeeping for one external_api_logs row, used by
 * the legacy sweep, the Sta Lucia sweep below, and the Sync Logs Retry button
 * (app/api/external-api/logs/[id]/retry/route.ts). Kept as one function so
 * those paths can't drift apart (e.g. one forgetting to clear next_retry_at
 * on success, or using a different retry backoff).
 */
export async function applySyncResult(
  log: { id: string; transaction_type: string; transaction_id: string },
  syncResult: { success: boolean; error?: string; permanent?: boolean },
): Promise<void> {
  if (syncResult.success) {
    // Success: Mark as success
    await query('UPDATE external_api_logs SET status = "success", error_message = NULL, next_retry_at = NULL WHERE id = ?', [log.id]);
    console.log(`✅ Success: Synced ${log.transaction_type} (${log.transaction_id})`);
  } else if (syncResult.permanent) {
    // Terminal failure: retrying can never change the outcome (e.g. the
    // z_readings row this log points at was deleted). Park it in a status the
    // sweep's WHERE clause does not select, so it stops consuming a retry slot
    // instead of re-resolving the same dead reference every 15 minutes
    // forever. The error message is kept so the Sync Logs tab explains why.
    await query(`
      UPDATE external_api_logs
      SET status = 'abandoned',
          error_message = ?,
          last_retry_at = NOW(),
          next_retry_at = NULL
      WHERE id = ?
    `, [syncResult.error || 'Permanently failed', log.id]);
    console.warn(`⛔ Abandoned: ${log.transaction_type} (${log.transaction_id}) — ${syncResult.error || 'permanent failure'}`);
  } else {
    // Failure: Log but keep in queue (system will retry next sweep)
    const nextRetry = new Date();
    nextRetry.setMinutes(nextRetry.getMinutes() + 15); // Wait longer between sweeps
    const nextRetryStr = nextRetry.toISOString().slice(0, 19).replace('T', ' ');

    await query(`
      UPDATE external_api_logs
      SET error_message = ?,
          last_retry_at = NOW(),
          next_retry_at = ?
      WHERE id = ?
    `, [syncResult.error || 'Sync failed', nextRetryStr, log.id]);
    console.log(`❌ Failed: Could not sync ${log.transaction_type} (${log.transaction_id}). Next retry at ${nextRetryStr}`);
  }
}

/**
 * Sta Lucia gets its own query and its own LIMIT, run after the legacy
 * sweep below. The legacy sweep takes a single fixed-size batch (LIMIT 10)
 * across all transaction types ordered by created_at — on an install that
 * accumulates 10+ simultaneously-due legacy rows (exactly what happened in
 * this dev DB: 14 legacy rows, some with thousands of retries), Sta Lucia
 * rows sitting behind that backlog would never be reached and the retry
 * this task exists to add would silently never run. A dedicated pass with
 * its own LIMIT means a legacy backlog can never starve Sta Lucia retries.
 */
async function processStaLuciaRetries(): Promise<void> {
  const staItems = await query(`
    SELECT * FROM external_api_logs
     WHERE transaction_type = 'STA_LUCIA_SALES'
       AND (status = 'pending' OR status = 'failed')
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY created_at ASC
     LIMIT 10
  `);

  // Nothing due — return before spending a query on the config.
  if (staItems.length === 0) return;

  // Read once, outside the loop: the config cannot change mid-sweep, and the
  // log rows do not carry an apiId anyway (the sender resolves the enabled
  // Sta Lucia config itself — a single-store deployment has exactly one).
  //
  // Only 'retry' opts into the automatic sweep. 'queue' means the operator
  // retries by hand from the Sync Logs tab, and 'log_only' means never —
  // auto-retrying either would ignore the setting.
  const staCfg = await loadStaLuciaConfig();
  if (staCfg?.onErrorAction !== 'retry') return;

  console.log(`--- Sync Queue: Processing ${staItems.length} Sta Lucia item(s) ---`);

  for (const log of staItems) {
    try {
      console.log(`Retrying ${log.transaction_type} sync for ID: ${log.transaction_id}`);

      const r = await sendZReadingToStaLucia(log.transaction_id);
      await applySyncResult(log, { success: r.success, error: r.error, permanent: r.permanent });
    } catch (itemError) {
      console.error(`Error processing Sta Lucia sync queue item ${log.id}:`, itemError);
    }
  }
}

/**
 * Sweeps the external_api_logs table and retries pending/failed syncs
 */
export async function processSyncQueue(): Promise<void> {
  try {
    // NOTE: no early return on `!apiConfig.enabled`. That flag comes from the
    // legacy external_api_settings table and says nothing about external_apis
    // rows; returning here would silently disable Sta Lucia retries. The gate
    // is applied per-item below, to legacy types only.
    const apiConfig = await getExternalApiConfig();

    // Find items that are pending or failed and due for retry. Sta Lucia is
    // excluded here and swept separately in processStaLuciaRetries() below —
    // see that function's comment for why — so nothing is ever processed
    // twice.
    const pendingItems = await query(`
      SELECT * FROM external_api_logs
      WHERE (status = 'pending' OR status = 'failed')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      AND transaction_type <> 'STA_LUCIA_SALES'
      ORDER BY created_at ASC
      LIMIT 10
    `);

    if (pendingItems.length > 0) {
      console.log(`--- Sync Queue: Processing ${pendingItems.length} items ---`);

      for (const log of pendingItems) {
        try {
          let syncResult: { success: boolean; error?: string };
          const payload = JSON.parse(log.payload);

          console.log(`Retrying ${log.transaction_type} sync for ID: ${log.transaction_id}`);

          if (LEGACY_SYNC_TYPES.includes(log.transaction_type) && !apiConfig.enabled) continue;

          switch (log.transaction_type) {
            case 'PURCHASE_ORDER':
              syncResult = await syncPurchaseTransaction(log.transaction_id, payload, apiConfig);
              break;
            case 'SUPPLIER_PAYMENT':
              syncResult = await syncPaymentTransaction(log.transaction_id, payload, apiConfig);
              break;
            case 'SALES_INVOICE':
              syncResult = await syncSalesTransaction(log.transaction_id, payload, apiConfig);
              break;
            case 'ACCOUNTS_PAYABLE':
              syncResult = await syncAccountsPayable(log.transaction_id, apiConfig);
              break;
            default:
              console.warn(`Unsupported transaction type in sync queue: ${log.transaction_type}`);
              continue;
          }

          await applySyncResult(log, syncResult);
        } catch (itemError) {
          console.error(`Error processing sync queue item ${log.id}:`, itemError);
        }
      }
    }

    await processStaLuciaRetries();
  } catch (error) {
    console.error('Failed to process sync queue:', error);
  }
}

/**
 * Pulls updates from the cloud server (Master Data)
 */
export async function processPullSync(): Promise<void> {
  try {
    const apiConfig = await getExternalApiConfig();
    if (!apiConfig.enabled || !apiConfig.apiEndpoint) return;

    console.log('--- Pull Sync: Checking for updates from cloud ---');

    await query(`
      CREATE TABLE IF NOT EXISTS external_api_settings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `, []);

    const lastSyncSetting = await query("SELECT setting_value FROM external_api_settings WHERE setting_key = 'last_pull_sync'", []);
    const lastSync = lastSyncSetting[0]?.setting_value || '';

    const url = `${apiConfig.apiEndpoint}/sync/pull?last_sync=${encodeURIComponent(lastSync)}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`Pull sync failed with status: ${response.status}`);
      return;
    }

    const result = await response.json();
    if (result.success && result.data) {
      const { products, categories, brands, users, userPermissions } = result.data;

      // 1. Update Products
      if (products && products.length > 0) {
        console.log(`Pull Sync: Received ${products.length} updated products.`);
        for (const product of products) {
          await query(`
            INSERT INTO products (
              id, name, barcode, price, cost, stock, category, brand, created_at, updated_at,
              description, additional_description, department, subcategory, reorder_point,
              avg_daily_sales, sku, image_url, image_hint, unit_of_measure, parent_id,
              conversion_factor, supplier_id, income_account, expense_account, warehouse_id,
              vat_status, availability, earns_points, expiration_date, shelf_location_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            barcode = VALUES(barcode),
            price = VALUES(price),
            cost = VALUES(cost),
            stock = VALUES(stock),
            category = VALUES(category),
            brand = VALUES(brand),
            updated_at = VALUES(updated_at),
            description = VALUES(description),
            additional_description = VALUES(additional_description),
            department = VALUES(department),
            subcategory = VALUES(subcategory),
            reorder_point = VALUES(reorder_point),
            avg_daily_sales = VALUES(avg_daily_sales),
            sku = VALUES(sku),
            image_url = VALUES(image_url),
            image_hint = VALUES(image_hint),
            unit_of_measure = VALUES(unit_of_measure),
            parent_id = VALUES(parent_id),
            conversion_factor = VALUES(conversion_factor),
            supplier_id = VALUES(supplier_id),
            income_account = VALUES(income_account),
            expense_account = VALUES(expense_account),
            warehouse_id = VALUES(warehouse_id),
            vat_status = VALUES(vat_status),
            availability = VALUES(availability),
            earns_points = VALUES(earns_points),
            expiration_date = VALUES(expiration_date),
            shelf_location_id = VALUES(shelf_location_id)
          `, [
            product.id, product.name, product.barcode, product.price, product.cost, 
            product.stock, product.category, product.brand, 
            product.created_at ? product.created_at.slice(0, 19).replace('T', ' ') : null,
            product.updated_at ? product.updated_at.slice(0, 19).replace('T', ' ') : null,
            product.description ?? null, 
            product.additional_description ?? null, 
            product.department ?? null, 
            product.subcategory ?? null, 
            product.reorder_point ?? null,
            product.avg_daily_sales ?? null, 
            product.sku ?? null, 
            product.image_url ?? null, 
            product.image_hint ?? null, 
            product.unit_of_measure ?? null, 
            product.parent_id ?? null,
            product.conversion_factor ?? null, 
            product.supplier_id ?? null, 
            product.income_account ?? null, 
            product.expense_account ?? null, 
            product.warehouse_id ?? null,
            product.vat_status ?? null, 
            product.availability ?? null, 
            product.earns_points ?? null, 
            product.expiration_date ? product.expiration_date.slice(0, 10) : null,
            product.shelf_location_id ?? null
          ]);
        }
      }

      // 2. Update Categories
      if (categories && categories.length > 0) {
        console.log(`Pull Sync: Received ${categories.length} categories.`);
        for (const cat of categories) {
          await query(`
            INSERT INTO categories (id, name, markup_percentage)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            markup_percentage = VALUES(markup_percentage)
          `, [cat.id, cat.name, cat.markup_percentage]);
        }
      }

      // 3. Update Brands
      if (brands && brands.length > 0) {
        console.log(`Pull Sync: Received ${brands.length} brands.`);
        for (const brand of brands) {
          await query(`
            INSERT INTO brands (id, name, markup_percentage)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            markup_percentage = VALUES(markup_percentage)
          `, [brand.id, brand.name, brand.markup_percentage]);
        }
      }

      // 4. Update Users
      if (users && users.length > 0) {
        console.log(`Pull Sync: Received ${users.length} users.`);
        for (const user of users) {
          await query(`
            INSERT INTO users (uid, username, password, user_type, display_name, disabled, creation_time)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            password = VALUES(password),
            user_type = VALUES(user_type),
            display_name = VALUES(display_name),
            disabled = VALUES(disabled)
          `, [
            user.uid, user.username, user.password, user.user_type, 
            user.display_name, user.disabled ? 1 : 0, 
            user.creation_time ? user.creation_time.slice(0, 19).replace('T', ' ') : null
          ]);
        }
      }

      // 5. Update User Permissions
      if (userPermissions && userPermissions.length > 0) {
        console.log(`Pull Sync: Received ${userPermissions.length} user permissions.`);
        for (const perm of userPermissions) {
          await query(`
            INSERT INTO user_permissions (id, user_uid, permission)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
            permission = VALUES(permission)
          `, [perm.id, perm.user_uid, perm.permission]);
        }
      }

      await query("INSERT INTO external_api_settings (setting_key, setting_value) VALUES ('last_pull_sync', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)", [result.timestamp]);
      console.log(`✅ Success: Synced data down (Products, Categories, Brands, Users).`);
    }
  } catch (error) {
    console.error('Failed to process pull sync:', error);
  }
}

export function initScheduler(): void {
  // Singleton-ish check to avoid multiple initializations in dev environment reloads
  if ((global as any).__backupSchedulerInitialized) {
    return;
  }
  
  const schedule = getSchedule();
  startScheduledBackup(schedule);
  
  // External accounting API sync queue (runs every 2 minutes)
  console.log('Starting background sync queue worker (2m interval)');
  cron.schedule('*/2 * * * *', async () => {
    await processSyncQueue();
    await processPullSync();
  });

  (global as any).__backupSchedulerInitialized = true;
  console.log('Backup scheduler initialized.');
}
