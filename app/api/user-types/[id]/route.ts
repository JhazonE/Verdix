import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/mysql';
import { v4 as uuidv4 } from 'uuid';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, permissions } = body;

    await withTransaction(async (connection) => {
      if (name !== undefined || description !== undefined) {
        const updates: string[] = [];
        const values: any[] = [];

        // Permissions are matched to users by TYPE NAME (users.user_type),
        // not by this row's id — see
        // docs/superpowers/specs/2026-09-28-user-type-permission-live-sync-design.md.
        // A rename must cascade to every user on the old name, or they
        // silently lose all access on their next login/permission read.
        let oldName: string | undefined;
        if (name !== undefined) {
          const [existing]: any = await connection.query('SELECT name FROM user_types WHERE id = ?', [id]);
          oldName = existing?.[0]?.name;
        }

        if (name !== undefined) {
          updates.push('name = ?');
          values.push(name);
        }
        if (description !== undefined) {
          updates.push('description = ?');
          values.push(description);
        }

        values.push(id);
        await connection.execute(
          `UPDATE user_types SET ${updates.join(', ')} WHERE id = ?`,
          values
        );

        if (oldName !== undefined && oldName !== name) {
          await connection.execute('UPDATE users SET user_type = ? WHERE user_type = ?', [name, oldName]);
        }
      }

      if (permissions !== undefined) {
        await connection.execute('DELETE FROM user_type_permissions WHERE user_type_id = ?', [id]);
        if (permissions.length > 0) {
          for (const permission of permissions) {
            await connection.execute(
              'INSERT INTO user_type_permissions (id, user_type_id, permission) VALUES (?, ?, ?)',
              [uuidv4(), id, permission]
            );
          }
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating user type:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if any users are using this type
    const userType: any = await query('SELECT name FROM user_types WHERE id = ?', [id]);
    if (!userType || userType.length === 0) {
      return NextResponse.json({ error: 'User type not found' }, { status: 404 });
    }

    const name = userType[0].name;

    const users: any = await query('SELECT uid FROM users WHERE user_type = ? LIMIT 1', [name]);
    if (users && users.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete user type. It is currently assigned to one or more users.' },
        { status: 400 }
      );
    }

    await withTransaction(async (connection) => {
      await connection.execute('DELETE FROM user_type_permissions WHERE user_type_id = ?', [id]);
      await connection.execute('DELETE FROM user_types WHERE id = ?', [id]);
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting user type:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
