import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { compare } from 'bcryptjs';

export async function POST(request: NextRequest) {
    try {
        const { username, password } = await request.json();

        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username and password are required' },
                { status: 400 }
            );
        }

        // Fetch user and their role category from database
        const users = await query(`
            SELECT 
                u.uid, u.username, u.password, u.user_type as userType, 
                u.display_name as displayName, u.photo_url as photoURL, u.disabled,
                ut.id as roleId
            FROM users u
            LEFT JOIN user_types ut ON u.user_type = ut.name OR u.user_type = ut.id
            WHERE u.username = ?
        `, [username]) as any[];

        const user = users[0];

        if (!user) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        if (user.disabled) {
            return NextResponse.json(
                { error: 'Account is disabled' },
                { status: 403 }
            );
        }

        // Verify password
        const isValid = await compare(password, user.password);

        if (!isValid) {
            return NextResponse.json(
                { error: 'Invalid credentials' },
                { status: 401 }
            );
        }

        // Permissions live on the user's TYPE now, not per-user — see
        // docs/superpowers/specs/2026-09-28-user-type-permission-live-sync-design.md.
        // Editing a type in Manage User Types changes every user of that
        // type's access on their next login.
        const permissions = await query(
            `SELECT utp.permission
             FROM users u
             JOIN user_types ut ON u.user_type = ut.name
             JOIN user_type_permissions utp ON utp.user_type_id = ut.id
             WHERE u.uid = ?`,
            [user.uid]
        ) as any[];

        const userPermissions = permissions.map((p: any) => p.permission);

        // Return user session data
        return NextResponse.json({
            uid: user.uid,
            username: user.username, // using "username" as the field
            email: user.username, // keeping "email" for compatibility if frontend expects it, or we can just use username
            userType: user.userType,
            roleId: user.roleId,
            displayName: user.displayName,
            photoURL: user.photoURL,
            permissions: userPermissions,
        });
    } catch (error: any) {
        console.error('Login error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
