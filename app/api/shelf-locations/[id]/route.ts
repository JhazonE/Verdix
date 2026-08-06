import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await params;
    const data = await request.json();
    const { name, description, isActive } = data;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Name is required' },
        { status: 400 }
      );
    }

    const sql = `
      UPDATE shelf_locations
      SET name = ?, description = ?, is_active = ?
      WHERE id = ?
    `;

    await query(sql, [name, description, isActive, id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to update shelf location:', error);
    if (error.code === 'ER_DUP_ENTRY') {
       return NextResponse.json(
        { success: false, error: 'A shelf location with this name already exists' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to update shelf location' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await params;

    // Check if the shelf location is in use
    const checkSql = 'SELECT COUNT(*) as count FROM products WHERE shelf_location_id = ?';
    const checkResult = await query(checkSql, [id]);
    
    if (checkResult[0].count > 0) {
        return NextResponse.json(
          { success: false, error: 'Cannot delete shelf location because it contains products.' },
          { status: 400 }
        );
    }

    const sql = 'DELETE FROM shelf_locations WHERE id = ?';
    await query(sql, [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete shelf location:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete shelf location' },
      { status: 500 }
    );
  }
}
