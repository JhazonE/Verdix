import { query } from './mysql';
import { v4 as uuidv4 } from 'uuid';

export async function checkApprovalRequired(txType: string): Promise<boolean> {
  try {
    // 1. Check if the master switch is ON in pos_settings
    const settingsMap: Record<string, string> = {
      'STOCK_ADJUSTMENT': 'require_adjustment_confirmation',
      'STOCK_TRANSFER': 'require_transfer_confirmation',
      'PURCHASE_ORDER': 'require_po_confirmation',
      'RECEIVE_PO': 'require_receive_confirmation',
      'BAD_ORDER': 'require_bad_order_confirmation',
      'STOCK_COUNT': 'require_stock_count_approval',
      'REPACKAGING': 'require_repackaging_confirmation',
      'SHELF_TRANSFER': 'require_shelf_transfer_confirmation',
      'PRODUCT_CREATE': 'require_product_confirmation',
      'PRICE_UPDATE': 'require_price_update_confirmation',
    };

    const settingColumn = settingsMap[txType];
    if (settingColumn) {
      const settings: any = await query(`SELECT ${settingColumn} FROM pos_settings LIMIT 1`);
      if (!settings || settings.length === 0 || !settings[0][settingColumn]) {
        // Master switch is OFF, skip multi-level approval
        return false;
      }
    }

    // 2. Check if a workflow is defined
    const workflows = await query(
      'SELECT id FROM approval_workflows WHERE transaction_type = ?',
      [txType]
    );
    return workflows && workflows.length > 0;
  } catch (error) {
    console.error('Error checking approval requirement:', error);
    return false;
  }
}

export async function submitToApprovalQueue(txType: string, txData: any, userId: string): Promise<{ queueId: string | null; pendingApproval: boolean }> {
  try {
    const queueId = uuidv4();
    
    // 1. Get creator's role UUID (resolve from name if necessary)
    const userRoleRes: any = await query(`
      SELECT ut.id 
      FROM users u 
      LEFT JOIN user_types ut ON u.user_type = ut.id OR u.user_type = ut.name
      WHERE u.uid = ?
    `, [userId]);
    const creatorRoleId = userRoleRes[0]?.id;

    // 2. Get workflow steps
    const steps: any = await query(
      'SELECT aw.*, ut.name as roleName FROM approval_workflows aw LEFT JOIN user_types ut ON aw.user_type_id = ut.id WHERE aw.transaction_type = ? ORDER BY aw.step_order ASC',
      [txType]
    );

    if (!steps || steps.length === 0) {
      return { queueId: null, pendingApproval: false };
    }

    let currentStep = 1;
    let skippedSteps: any[] = [];

    // 3. Determine how many steps to skip (Auto-approval for creator)
    for (const step of steps) {
      if (step.user_type_id === creatorRoleId) {
        skippedSteps.push(step);
        currentStep = step.step_order + 1;
      } else {
        // Stop at first step that creator CANNOT approve
        break;
      }
    }

    // 4. If all steps are skipped, execute immediately
    if (currentStep > steps.length) {
      return { queueId: null, pendingApproval: false };
    }

    // 5. Insert into queue starting at the correct next step
    const nextStepInfo = steps.find((s: any) => s.step_order === currentStep);
    
    await query(
      'INSERT INTO approval_queue (id, transaction_type, transaction_data, created_by, status, current_step) VALUES (?, ?, ?, ?, ?, ?)',
      [queueId, txType, JSON.stringify(txData), userId, 'Pending', currentStep]
    );

    // 6. Record history for skipped steps
    for (const step of skippedSteps) {
      await query(
        'INSERT INTO approval_history (id, approval_queue_id, user_id, action, notes, step_number) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), queueId, userId, 'Approve', 'Auto-approved by initiator', step.step_order]
      );
    }

    return { queueId, pendingApproval: true };
  } catch (error) {
    console.error('Error submitting to approval queue:', error);
    throw error;
  }
}

export async function getApprovalWorkflow(txType: string) {
  return await query(
    'SELECT aw.*, ut.name as roleName FROM approval_workflows aw LEFT JOIN user_types ut ON aw.user_type_id = ut.id WHERE aw.transaction_type = ? ORDER BY aw.step_order ASC',
    [txType]
  );
}
