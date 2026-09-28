import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { v4 as uuidv4 } from 'uuid';
import { hash } from 'bcryptjs';

export type UserWithPermissions = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  disabled: boolean;
  creationTime: string;
  permissions: string[];
};

// GET /api/users - List all users with their permissions
export async function GET() {
  try {
    // Fetch users from MySQL
    const users = await query('SELECT uid, username, username as email, user_type as userType, display_name as displayName, photo_url as photoURL, disabled, creation_time as creationTime FROM users ORDER BY creation_time DESC');

    // Permissions are derived from each user's TYPE now (Manage User
    // Types), not stored per-user — see
    // docs/superpowers/specs/2026-09-28-user-type-permission-live-sync-design.md.
    const typePermRows: any[] = await query(`
      SELECT ut.name AS typeName, utp.permission
      FROM user_types ut
      JOIN user_type_permissions utp ON utp.user_type_id = ut.id
    `);

    const permissionsByType = typePermRows.reduce((acc: any, curr: any) => {
      if (!acc[curr.typeName]) acc[curr.typeName] = [];
      acc[curr.typeName].push(curr.permission);
      return acc;
    }, {});

    // Map users with their effective (type-derived) permissions
    const usersWithPermissions = (users || []).map((user: any) => ({
      ...user,
      disabled: !!user.disabled,
      permissions: permissionsByType[user.userType] || [],
    }));

    return NextResponse.json(usersWithPermissions);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  console.log('[ROOT API/Users] POST request received');
  try {
    const body = await request.json();
    const { password, userType, permissions, displayName } = body;
    const username = body.username || body.email;

    if (!username) {
      return NextResponse.json(
        { error: 'Username or Email is required' },
        { status: 400 }
      );
    }

    const uid = uuidv4();
    const creationTime = new Date().toISOString();

    // Hash password if provided
    let hashedPassword = null;
    if (password) {
      hashedPassword = await hash(password, 10);
    }

    await withTransaction(async (connection) => {
      // Insert user
      await connection.execute(
        'INSERT INTO users (uid, username, password, user_type, display_name, photo_url, disabled, creation_time) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [uid, username, hashedPassword, userType || 'User', displayName || username.split('@')[0], '', false]
      );

      // Insert permissions
      if (permissions && permissions.length > 0) {
        for (const permission of permissions) {
          await connection.execute(
            'INSERT INTO user_permissions (id, user_uid, permission) VALUES (?, ?, ?)',
            [uuidv4(), uid, permission]
          );
        }
      }
    });

    return NextResponse.json({
      uid,
      username,
      email: username,
      userType: userType || 'User',
      displayName: username.split('@')[0],
      photoURL: '',
      disabled: false,
      creationTime,
      permissions: permissions || [],
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 500 }
    );
  }
}

// PATCH /api/users - Update user permissions
export async function PATCH(request: NextRequest) {
  try {
    const { uid, permissions, disabled } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: 'User UID is required' }, { status: 400 });
    }

    await withTransaction(async (connection) => {
      // Update disabled status if provided
      if (disabled !== undefined) {
        await connection.execute('UPDATE users SET disabled = ? WHERE uid = ?', [!!disabled, uid]);
      }

      // Update permissions if provided
      if (permissions !== undefined) {
        // Delete existing permissions
        await connection.execute('DELETE FROM user_permissions WHERE user_uid = ?', [uid]);

        // Insert new permissions
        if (permissions.length > 0) {
          for (const permission of permissions) {
            await connection.execute(
              'INSERT INTO user_permissions (id, user_uid, permission) VALUES (?, ?, ?)',
              [uuidv4(), uid, permission]
            );
          }
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating user permissions:', error);
    return NextResponse.json({ error: error.message || 'Failed to update user' }, { status: 500 });
  }
}

// DELETE /api/users - Delete a user
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const uid = searchParams.get('uid');

    if (!uid) {
      return NextResponse.json({ error: 'User UID is required' }, { status: 400 });
    }

    // Check for dependencies
    const posTransactions: any = await query('SELECT id FROM pos_transactions WHERE user_id = ? LIMIT 1', [uid]);
    const shifts: any = await query('SELECT id FROM shifts WHERE user_id = ? LIMIT 1', [uid]);
    const auditLogs: any = await query('SELECT id FROM payment_audit_log WHERE user_id = ? LIMIT 1', [uid]);
    const cashTransfers: any = await query('SELECT id FROM cash_transfers WHERE user_id = ? LIMIT 1', [uid]);

    if ((posTransactions && posTransactions.length > 0) || 
        (shifts && shifts.length > 0) || 
        (auditLogs && auditLogs.length > 0) ||
        (cashTransfers && cashTransfers.length > 0)) {
      return NextResponse.json(
        { error: 'Cannot delete user. This user has associated transactions, shifts, or cash transfer records. For data integrity, these users cannot be deleted. Consider disabling the account instead.' },
        { status: 400 }
      );
    }

    await withTransaction(async (connection) => {
      // Delete user permissions first
      await connection.execute('DELETE FROM user_permissions WHERE user_uid = ?', [uid]);

      // Delete user
      await connection.execute('DELETE FROM users WHERE uid = ?', [uid]);
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete user' }, { status: 500 });
  }
}
