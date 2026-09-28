import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '@/lib/mysql';
import { hash } from 'bcryptjs';

// PUT /api/users/[uid] - Update user details and permissions
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const { uid } = await params;
    const body = await request.json();
    const { username, password, userType, displayName } = body;

    if (!uid) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    await withTransaction(async (connection) => {
      // Update user basic info
      let updateFields = ['username = ?', 'display_name = ?', 'user_type = ?'];
      let queryParams = [username, displayName || username.split('@')[0], userType || 'User'];

      if (password) {
        const hashedPassword = await hash(password, 10);
        updateFields.push('password = ?');
        queryParams.push(hashedPassword);
      }

      queryParams.push(uid);
      await connection.execute(
        `UPDATE users SET ${updateFields.join(', ')} WHERE uid = ?`,
        queryParams
      );
    });

    return NextResponse.json({
      success: true,
      message: 'User updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update user' },
      { status: 500 }
    );
  }
}
