import { query } from './mysql';
import type { PoolConnection } from 'mysql2/promise';

export type SellingUnit = {
  id: string;
  productId: string;
  name: string;
  barcode: string | null;
  factor: number;
  cost: number | null;
  price: number;
  isBase: boolean;
};

function mapRow(r: any): SellingUnit {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    barcode: r.barcode ?? null,
    factor: Number(r.factor),
    cost: r.cost === null || r.cost === undefined ? null : Number(r.cost),
    price: Number(r.price),
    isBase: r.is_base === 1,
  };
}

/**
 * Base units moved by selling `quantity` of a unit worth `factor` base units.
 *
 * Negative quantities are legal and stay negative — that is a return putting
 * stock back. A zero, NaN or negative FACTOR throws rather than returning 0,
 * because a silent zero would deduct nothing and leave stock quietly wrong.
 */
export function baseQuantity(quantity: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`Invalid selling unit factor: ${factor}`);
  }
  return quantity * factor;
}

const SELECT_UNIT = `
  SELECT id, product_id, name, barcode, factor, cost, price, is_base
  FROM product_selling_units
`;

async function run(sql: string, params: any[], connection?: PoolConnection) {
  if (connection) {
    const [rows]: any = await connection.query(sql, params);
    return rows;
  }
  return query(sql, params);
}

/** The selling unit a scanned barcode identifies, or null. */
export async function resolveSellingUnit(
  barcode: string,
  connection?: PoolConnection,
): Promise<SellingUnit | null> {
  const trimmed = String(barcode ?? '').trim();
  if (!trimmed) return null;
  const rows: any = await run(`${SELECT_UNIT} WHERE barcode = ? LIMIT 1`, [trimmed], connection);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** A product's base unit (factor 1). Every product has exactly one. */
export async function getBaseUnit(
  productId: string,
  connection?: PoolConnection,
): Promise<SellingUnit | null> {
  const rows: any = await run(
    `${SELECT_UNIT} WHERE product_id = ? AND is_base = 1 LIMIT 1`,
    [productId],
    connection,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}
