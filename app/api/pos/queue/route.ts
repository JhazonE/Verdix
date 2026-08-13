import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { v4 as uuidv4 } from 'uuid';

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS pos_queued_orders (
      id VARCHAR(36) PRIMARY KEY,
      queue_number INT NOT NULL AUTO_INCREMENT UNIQUE,
      daily_queue_number INT NOT NULL DEFAULT 1,
      items JSON NOT NULL,
      customer_id VARCHAR(36),
      customer_name VARCHAR(255) DEFAULT 'Walk-in',
      queue_notes TEXT NULL,
      frontliner_id VARCHAR(36) NOT NULL,
      frontliner_name VARCHAR(255),
      terminal_id VARCHAR(36),
      terminal_name VARCHAR(255),
      shift_id VARCHAR(36),
      status ENUM('pending','claimed','completed','cancelled') DEFAULT 'pending',
      claimed_by VARCHAR(36),
      claimed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_status (status),
      KEY idx_created (created_at)
    ) AUTO_INCREMENT=1
  `);

  // Add new columns to existing tables
  const existing = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_NAME = 'pos_queued_orders' AND TABLE_SCHEMA = DATABASE()`
  ) as any[];
  const cols = new Set(existing.map((c: any) => c.COLUMN_NAME));

  if (!cols.has('daily_queue_number')) {
    await query(`ALTER TABLE pos_queued_orders ADD COLUMN daily_queue_number INT NOT NULL DEFAULT 1 AFTER queue_number`);
  }
  if (!cols.has('queue_notes')) {
    await query(`ALTER TABLE pos_queued_orders ADD COLUMN queue_notes TEXT NULL AFTER customer_name`);
  }
}

// GET - list all pending queued orders (for cashier)
export async function GET() {
  try {
    await ensureTable();
    const rows = await query(
      `SELECT id, queue_number AS queueNumber, daily_queue_number AS dailyQueueNumber,
              items, customer_id AS customerId,
              customer_name AS customerName, queue_notes AS queueNotes,
              frontliner_id AS fronlinerId,
              frontliner_name AS frontlinerName, terminal_id AS terminalId,
              terminal_name AS terminalName, shift_id AS shiftId,
              status, created_at AS createdAt
       FROM pos_queued_orders
       WHERE status = 'pending'
       ORDER BY created_at ASC`
    ) as any[];

    const orders = rows.map(r => ({
      ...r,
      items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items,
    }));

    return NextResponse.json({ success: true, data: orders });
  } catch (error) {
    console.error('Queue GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch queue' }, { status: 500 });
  }
}

// POST - frontliner sends order to queue
export async function POST(request: NextRequest) {
  try {
    await ensureTable();
    const body = await request.json();
    const { items, customerId, customerName, queueNotes, fronlinerId, frontlinerName, terminalId, terminalName, shiftId } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: 'No items in order' }, { status: 400 });
    }
    if (!fronlinerId) {
      return NextResponse.json({ success: false, error: 'Frontliner ID required' }, { status: 400 });
    }

    // Ensure counter table exists (may not exist on first run)
    await query(`
      CREATE TABLE IF NOT EXISTS pos_queue_counter (
        id INT PRIMARY KEY DEFAULT 1,
        current_number INT NOT NULL DEFAULT 0,
        max_number INT NOT NULL DEFAULT 999,
        auto_reset_daily TINYINT(1) NOT NULL DEFAULT 1,
        last_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_reset_date DATE NULL
      )
    `);
    await query(`INSERT IGNORE INTO pos_queue_counter (id) VALUES (1)`);

    // Get counter config and compute next queue number
    // (dateDiffDays > 0 means last_reset_date is before today, compared server-side
    // in MySQL's own timezone to avoid local-Date/UTC round-trip mismatches)
    const [counter] = await query(
      `SELECT current_number AS currentNumber, max_number AS maxNumber,
              auto_reset_daily AS autoResetDaily,
              DATEDIFF(CURDATE(), last_reset_date) AS dateDiffDays
       FROM pos_queue_counter WHERE id = 1`
    ) as any[];

    let nextNumber = (Number(counter?.currentNumber) || 0) + 1;
    const maxNumber = Number(counter?.maxNumber) || 999;
    const autoResetDaily = counter?.autoResetDaily ?? 1;

    // Auto-reset daily if enabled and date changed
    if (autoResetDaily) {
      const dateDiffDays = counter?.dateDiffDays;
      if (dateDiffDays === null || Number(dateDiffDays) !== 0) {
        await query(
          `UPDATE pos_queue_counter SET current_number = 0, last_reset_at = NOW(), last_reset_date = CURDATE() WHERE id = 1`
        );
        nextNumber = 1;
      }
    }

    // Auto-reset when max reached
    if (nextNumber > maxNumber) {
      await query(
        `UPDATE pos_queue_counter SET current_number = 0, last_reset_at = NOW(), last_reset_date = CURDATE() WHERE id = 1`
      );
      nextNumber = 1;
    }

    await query(`UPDATE pos_queue_counter SET current_number = ? WHERE id = 1`, [nextNumber]);
    const dailyQueueNumber = nextNumber;

    const id = uuidv4();
    await query(
      `INSERT INTO pos_queued_orders
         (id, daily_queue_number, items, customer_id, customer_name, queue_notes,
          frontliner_id, frontliner_name, terminal_id, terminal_name, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        dailyQueueNumber,
        JSON.stringify(items),
        customerId || null,
        customerName || 'Walk-in',
        queueNotes || null,
        fronlinerId,
        frontlinerName || '',
        terminalId || null,
        terminalName || null,
        shiftId || null,
      ]
    );

    const [created] = await query(
      'SELECT queue_number AS queueNumber, daily_queue_number AS dailyQueueNumber FROM pos_queued_orders WHERE id = ?', [id]
    ) as any[];

    return NextResponse.json({
      success: true,
      data: { id, queueNumber: created?.queueNumber, dailyQueueNumber: created?.dailyQueueNumber },
    });
  } catch (error) {
    console.error('Queue POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to queue order' }, { status: 500 });
  }
}

// DELETE - cashier claims/removes a queued order
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID required' }, { status: 400 });

    await ensureTable();

    const [row] = await query(
      `SELECT id, items, customer_id AS customerId, customer_name AS customerName,
              queue_notes AS queueNotes,
              frontliner_id AS fronlinerId, frontliner_name AS frontlinerName,
              queue_number AS queueNumber, daily_queue_number AS dailyQueueNumber
       FROM pos_queued_orders WHERE id = ? AND status = 'pending'`, [id]
    ) as any[];

    if (!row) return NextResponse.json({ success: false, error: 'Order not found or already claimed' }, { status: 404 });

    await query(
      `UPDATE pos_queued_orders SET status = 'claimed', claimed_at = NOW() WHERE id = ?`, [id]
    );

    return NextResponse.json({
      success: true,
      data: {
        ...row,
        items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
      },
    });
  } catch (error) {
    console.error('Queue DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to claim order' }, { status: 500 });
  }
}
