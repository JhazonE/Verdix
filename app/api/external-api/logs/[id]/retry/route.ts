import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { getExternalApiConfig } from '@/lib/external-api-config';
import {
  syncPurchaseTransaction,
  syncPaymentTransaction,
  syncAccountsPayable
} from '@/lib/services/external-accounting-api';
import { applySyncResult } from '@/lib/scheduler';
import { sendZReadingToStaLucia, TRANSACTION_TYPE as STA_LUCIA_TYPE } from '@/lib/integrations/sta-lucia/send-z-reading';

/**
 * POST /api/external-api/logs/[id]/retry
 * Retry a failed sync operation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: logId } = await params;

    // Fetch the log entry
    const logResult = await query('SELECT * FROM external_api_logs WHERE id = ?', [logId]);
    if (logResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Log entry not found' },
        { status: 404 }
      );
    }

    const log = logResult[0];

    // Sta Lucia is handled BEFORE the legacy gate below, on purpose. That gate
    // reads external_api_settings.enabled, which describes the legacy
    // accounting integration and says nothing about the `external_apis` row
    // that configures Sta Lucia — letting it block this branch would make the
    // Retry button permanently dead on every install that never enabled the
    // legacy sync. The gate is applied per-type instead, exactly as
    // processSyncQueue() in lib/scheduler.ts now does.
    //
    // This branch also runs before the JSON.parse below: the sender rebuilds
    // the payload from the z_readings row rather than replaying the logged
    // bytes, so a row with a null or truncated payload must still be
    // retryable. Sta Lucia enablement is enforced inside the sender, which
    // resolves only enabled provider='sta_lucia' configs.
    if (log.transaction_type === STA_LUCIA_TYPE) {
      const r = await sendZReadingToStaLucia(log.transaction_id);
      await applySyncResult(log, { success: r.success, error: r.error, permanent: r.permanent });

      if (r.success) {
        return NextResponse.json({
          success: true,
          message: r.skipped
            ? `Z-reading ${r.zReadingId} was already submitted; the log entry has been reconciled.`
            : 'Retry successful',
        });
      }
      return NextResponse.json({ success: false, error: r.error || 'Retry failed again' });
    }

    const apiConfig = await getExternalApiConfig();

    if (!apiConfig.enabled) {
      return NextResponse.json(
        { success: false, error: 'External API integration is currently disabled' },
        { status: 400 }
      );
    }

    let syncResult: { success: boolean; error?: string };
    const payload = JSON.parse(log.payload);

    // Determine what to retry based on transaction type
    switch (log.transaction_type) {
      case 'PURCHASE_ORDER':
        syncResult = await syncPurchaseTransaction(log.transaction_id, payload, apiConfig);
        break;
      case 'SUPPLIER_PAYMENT':
        syncResult = await syncPaymentTransaction(log.transaction_id, payload, apiConfig);
        break;
      case 'ACCOUNTS_PAYABLE':
        // For accounts payable, we sync current balance, not old payload usually
        // but for a strict 'retry' of a specific attempt, we could use payload.
        // However, it's better to sync latest state.
        syncResult = await syncAccountsPayable(log.transaction_id, apiConfig);
        break;
      default:
        return NextResponse.json(
          { success: false, error: `Unsupported transaction type: ${log.transaction_type}` },
          { status: 400 }
        );
    }

    if (syncResult.success) {
      // Mark original log as resolved or just update it?
      // Usually better to keep history and just mark this one as succeeded now
      await query('UPDATE external_api_logs SET status = "success", error_message = NULL WHERE id = ?', [logId]);
      
      return NextResponse.json({
        success: true,
        message: 'Retry successful',
      });
    } else {
      return NextResponse.json({
        success: false,
        error: syncResult.error || 'Retry failed again',
      });
    }
  } catch (error) {
    console.error('Error retrying API sync:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process retry request' },
      { status: 500 }
    );
  }
}
