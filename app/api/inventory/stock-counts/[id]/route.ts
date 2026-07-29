import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    console.log("API ROUTE HIT GET /api/inventory/stock-counts/[id]. Received ID:", id);

    // Fetch the main count details
    const countSql = `SELECT * FROM stock_counts WHERE id = ?`;
    const countResult: any = await query(countSql, [id]);

    if (!countResult || countResult.length === 0) {
      return NextResponse.json({ error: 'Stock count not found' }, { status: 404 });
    }

    const count = countResult[0];

    // Fetch the items associated with this count
    const itemsSql = `
      SELECT sci.*, p.name as product_name, p.sku as product_sku, p.barcode as product_barcode, p.cost as product_cost, p.price as product_retail
      FROM stock_count_items sci
      JOIN products p ON sci.product_id = p.id
      WHERE sci.stock_count_id = ?
    `;
    const items = await query(itemsSql, [id]);

    return NextResponse.json({
      success: true,
      data: {
        ...count,
        items
      }
    });

  } catch (error) {
    console.error('Error fetching stock count details:', error);
    return NextResponse.json({ error: 'Failed to fetch stock count details: ' + (error as Error).message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { name, notes } = body;

    await query(
      `UPDATE stock_counts SET name = coalesce(?, name), notes = coalesce(?, notes) WHERE id = ?`,
      [name, notes, id]
    );

    return NextResponse.json({ message: 'Stock count updated successfully' });
  } catch (error) {
    console.error('Error updating stock count:', error);
    return NextResponse.json({ error: 'Failed to update stock count' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    
    // We shouldn't delete completed counts generally, maybe just mark as cancelled. 
    // If it's in_progress we can just let it be deleted easily.
    const countResult: any = await query(`SELECT status FROM stock_counts WHERE id = ?`, [id]);
    
    if (!countResult || countResult.length === 0) {
      return NextResponse.json({ error: 'Stock count not found' }, { status: 404 });
    }

    if (countResult[0].status === 'completed') {
       return NextResponse.json({ error: 'Cannot delete a completed stock count' }, { status: 400 });
    }

    // Since we have ON DELETE CASCADE on stock_count_items, deleting the parent is enough
    await query(`DELETE FROM stock_counts WHERE id = ?`, [id]);

    return NextResponse.json({ message: 'Stock count deleted successfully' });
  } catch (error) {
    console.error('Error deleting stock count:', error);
    return NextResponse.json({ error: 'Failed to delete stock count' }, { status: 500 });
  }
}
