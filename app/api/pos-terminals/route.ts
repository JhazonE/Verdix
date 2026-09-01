import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../../lib/mysql';
import { countActiveTerminals, isSeatOverage } from '../../../lib/licensing/terminal-count';
import { readLicenseState } from '../../../lib/licensing/state-store';

// Helper function to ensure pos_terminals table exists
async function ensurePosTerminalsTable() {
  try {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS pos_terminals (
        id VARCHAR(50) PRIMARY KEY,
        ip_address VARCHAR(45),
        name VARCHAR(100),
        serial_number VARCHAR(100),
        min_number VARCHAR(100),
        permit_no VARCHAR(100),
        accreditation_no VARCHAR(100),
        permit_date_issued DATE,
        print_official_receipt VARCHAR(10) DEFAULT 'No',
        or_next_reference VARCHAR(100),
        location VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE,
        last_active TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_is_active (is_active)
      )
    `;
    
    await query(createTableSQL);

    // Add missing columns if table already exists
    const columns = [
      { name: 'serial_number', type: 'VARCHAR(100)' },
      { name: 'min_number', type: 'VARCHAR(100)' },
      { name: 'permit_no', type: 'VARCHAR(100)' },
      { name: 'accreditation_no', type: 'VARCHAR(100)' },
      { name: 'permit_date_issued', type: 'DATE' },
      { name: 'print_official_receipt', type: 'VARCHAR(10) DEFAULT "No"' },
      { name: 'or_next_reference', type: 'VARCHAR(100)' },
      { name: 'last_active', type: 'TIMESTAMP NULL' },
      { name: 'z_counter', type: 'INT DEFAULT 0' },
      { name: 'reset_counter', type: 'INT DEFAULT 0' }
    ];

    // Get current columns
    const currentColumnsResult = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pos_terminals' AND TABLE_SCHEMA = DATABASE()"
    );
    const existingColumns = new Set(currentColumnsResult.map((c: any) => c.COLUMN_NAME));

    for (const col of columns) {
      if (!existingColumns.has(col.name)) {
        try {
          await query(`ALTER TABLE pos_terminals ADD COLUMN ${col.name} ${col.type}`);
        } catch (e) {
          // Fallback catch
        }
      }
    }

  } catch (error) {
    console.error('Error ensuring pos_terminals table:', error);
    throw error;
  }
}

// GET endpoint to fetch POS terminals
export async function GET(request: NextRequest) {
  try {
    await ensurePosTerminalsTable();

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const search = searchParams.get('search');
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const getNextOR = searchParams.get('getNextOR') === 'true';

    if (getNextOR) {
      const sql = `
        SELECT or_next_reference 
        FROM pos_terminals 
        WHERE or_next_reference REGEXP '^[0-9]+$'
        ORDER BY CAST(or_next_reference AS UNSIGNED) DESC 
        LIMIT 1
      `;
      const result = await query(sql);
      
      let nextRef = '00000001';
      if (result && result.length > 0) {
        const currentMax = parseInt(result[0].or_next_reference);
        nextRef = (currentMax + 1).toString().padStart(8, '0');
      }

      return NextResponse.json({
        success: true,
        data: nextRef,
        timestamp: new Date().toISOString()
      });
    }

    let sql = `
      SELECT
        id,
        ip_address AS ipAddress,
        name AS terminalDescription,
        serial_number AS serialNumber,
        min_number AS min,
        permit_no AS permitNo,
        accreditation_no AS accreditationNo,
        permit_date_issued AS permitDateIssued,
        print_official_receipt AS printOfficialReceipt,
        or_next_reference AS orNextReference,
        location AS inventoryLocation,
        is_active AS isActive,
        last_active AS lastActive,
        created_at AS createdAt,
        z_counter AS zCounter,
        reset_counter AS resetCounter
      FROM pos_terminals
      WHERE 1=1
    `;
    const params: any[] = [];

    if (activeOnly) {
      sql += ' AND is_active = ?';
      params.push(true);
    }

    if (search) {
      sql += ' AND (name LIKE ? OR ip_address LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const terminals = await query(sql, params);

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM pos_terminals WHERE 1=1';
    const countParams: any[] = [];

    if (activeOnly) {
      countSql += ' AND is_active = ?';
      countParams.push(true);
    }

    if (search) {
      countSql += ' AND (name LIKE ? OR ip_address LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`);
    }

    const countResult = await query(countSql, countParams);
    const total = countResult[0]?.total || 0;

    // Get client IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                     request.headers.get('x-real-ip') || 
                     (request as any).ip || 
                     '127.0.0.1';

    return NextResponse.json({
      success: true,
      data: terminals,
      clientIp,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching POS terminals:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch POS terminals' },
      { status: 500 }
    );
  }
}

// POST endpoint to create a new POS terminal
export async function POST(request: NextRequest) {
  try {
    await ensurePosTerminalsTable();

    const body = await request.json();
    const {
      ipAddress,
      terminalDescription,
      serialNumber,
      min,
      permitNo,
      accreditationNo,
      permitDateIssued,
      printOfficialReceipt,
      orNextReference,
      inventoryLocation,
      isActive = true,
      zCounter = 0,
      resetCounter = 0
    } = body;

    // Seat-limit guard: block creating an ADDITIONAL terminal beyond the
    // licensed seat count. Never blocks checkout or existing terminals — only
    // new-terminal creation. A null seatLimit (desktop, or an uncapped
    // license) leaves this inert.
    const state = await readLicenseState();
    const seatLimit = state?.seatLimit ?? null;
    const current = await countActiveTerminals();
    if (isSeatOverage(current + 1, seatLimit)) {
      return NextResponse.json(
        {
          success: false,
          error: `Licensed for ${seatLimit} terminal(s); ${current} are already active. Contact your vendor to add seats.`,
        },
        { status: 403 }
      );
    }

    // Generate ID
    const id = `terminal_${Date.now()}`;

    const sql = `
      INSERT INTO pos_terminals (
        id, ip_address, name, serial_number, min_number,
        permit_no, accreditation_no, permit_date_issued, print_official_receipt, or_next_reference,
        location, is_active, z_counter, reset_counter
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await query(sql, [
      id,
      ipAddress?.trim() || null,
      terminalDescription?.trim() || null,
      serialNumber?.trim() || null,
      min?.trim() || null,
      permitNo?.trim() || null,
      accreditationNo?.trim() || null,
      permitDateIssued?.trim() || null,
      printOfficialReceipt || 'No',
      orNextReference?.trim() || null,
      inventoryLocation || 'Store',
      isActive,
      zCounter,
      resetCounter
    ]);

    return NextResponse.json({
      success: true,
      message: 'POS terminal created successfully',
      data: {
        id,
        ipAddress: ipAddress?.trim() || null,
        terminalDescription: terminalDescription?.trim() || null,
        serialNumber: serialNumber?.trim() || null,
        min: min?.trim() || null,
        permitNo: permitNo?.trim() || null,
        accreditationNo: accreditationNo?.trim() || null,
        permitDateIssued: permitDateIssued?.trim() || null,
        printOfficialReceipt: printOfficialReceipt || 'No',
        orNextReference: orNextReference?.trim() || null,
        inventoryLocation: inventoryLocation || 'Store',
        isActive,
        zCounter,
        resetCounter
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error creating POS terminal:', error);

    return NextResponse.json(
      { success: false, error: 'Failed to create POS terminal' },
      { status: 500 }
    );
  }
}

// PUT endpoint to update a POS terminal
export async function PUT(request: NextRequest) {
  try {
    await ensurePosTerminalsTable();

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Terminal ID is required' },
        { status: 400 }
      );
    }

    // Build dynamic UPDATE query
    const updates: string[] = [];
    const params: any[] = [];

    const fieldMap: Record<string, string> = {
      ipAddress: 'ip_address',
      terminalDescription: 'name',
      serialNumber: 'serial_number',
      min: 'min_number',
      permitNo: 'permit_no',
      accreditationNo: 'accreditation_no',
      permitDateIssued: 'permit_date_issued',
      printOfficialReceipt: 'print_official_receipt',
      orNextReference: 'or_next_reference',
      inventoryLocation: 'location',
      isActive: 'is_active',
      zCounter: 'z_counter',
      resetCounter: 'reset_counter'
    };

    Object.entries(fieldMap).forEach(([bodyKey, dbColumn]) => {
      if (body[bodyKey] !== undefined) {
        updates.push(`${dbColumn} = ?`);
        const val = body[bodyKey];
        params.push(typeof val === 'string' ? (val.trim() || null) : val);
      }
    });

    // Always update last_active
    updates.push('last_active = ?');
    params.push(new Date());

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      );
    }

    params.push(id);
    const sql = `UPDATE pos_terminals SET ${updates.join(', ')} WHERE id = ?`;

    await query(sql, params);

    return NextResponse.json({
      success: true,
      message: 'POS terminal updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error updating POS terminal:', error);

    return NextResponse.json(
      { success: false, error: 'Failed to update POS terminal' },
      { status: 500 }
    );
  }
}

// DELETE endpoint to delete a POS terminal
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Terminal ID is required' },
        { status: 400 }
      );
    }

    const sql = 'DELETE FROM pos_terminals WHERE id = ?';
    await query(sql, [id]);

    return NextResponse.json({
      success: true,
      message: 'POS terminal deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error deleting POS terminal:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete POS terminal' },
      { status: 500 }
    );
  }
}
