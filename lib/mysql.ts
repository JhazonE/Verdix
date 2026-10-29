import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
export { formatSINumber, validateSINumber } from './si-number';

// Load environment variables
dotenv.config();

// Initialize backup scheduler
import './init-scheduler';

// Extend the global object to hold the pool
declare global {
  var __mysqlPool: mysql.Pool | undefined;
}

// Create connection pool singleton.
// DB_SSL=true enables TLS for remote/cloud MySQL (e.g. Railway proxy).
// DB_POOL_LIMIT caps connections per app instance, so several terminals sharing
// one cloud DB don't exhaust the server's max_connections. It is a CEILING per
// terminal, not a knob to minimise: see MIN_POOL_LIMIT below for the floor it
// cannot go under, and why.
// The smallest pool this app can actually run on.
//
// One POS checkout issues ~31 queries inside a single transaction, so it holds
// its connection for the whole sale. A handful of simultaneous users plus the
// background workers (cron sweeps, sync queue) will exceed a pool of 10, and
// because mysql2 queues waiters with no timer, exceeding it reads as the app
// freezing rather than as an error. A deployment that had DB_POOL_LIMIT=10
// behaved exactly that way.
//
// Honouring a value below this floor is never what the operator wants: the
// setting exists to keep SEVERAL TERMINALS from exhausting a shared cloud DB's
// max_connections, which is an argument for a ceiling per terminal, not for a
// number too small to serve one terminal's own users. So a lower value is
// raised and logged rather than obeyed silently.
const MIN_POOL_LIMIT = 25;

function resolvePoolLimit(fallback: number): number {
  const configured = parseInt(process.env.DB_POOL_LIMIT || '');
  if (!Number.isFinite(configured) || configured <= 0) return fallback;
  if (configured < MIN_POOL_LIMIT) {
    console.warn(
      `[DB] DB_POOL_LIMIT=${configured} is below the ${MIN_POOL_LIMIT}-connection floor and was raised. ` +
        `A single checkout holds one connection for ~31 queries, so a pool this small makes ` +
        `concurrent users queue behind each other and the app appear to hang.`
    );
    return MIN_POOL_LIMIT;
  }
  return configured;
}

function buildPoolConfig(connectionLimit: number): mysql.PoolOptions {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'verdix',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: resolvePoolLimit(connectionLimit),
    queueLimit: 0,
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  };
}

let pool: mysql.Pool;

if (process.env.NODE_ENV === 'production') {
  pool = mysql.createPool(buildPoolConfig(50));
} else {
  if (!global.__mysqlPool) {
    global.__mysqlPool = mysql.createPool(buildPoolConfig(20));
    console.log('--- Database Connection Pool Created ---');
  }
  pool = global.__mysqlPool;
}

/**
 * Execute a SQL query against the MySQL database
 * @param sql - SQL query string
 * @param params - Optional parameters for the query
 * @returns Query results
 */
export async function query(sql: string, params?: any[]): Promise<any> {
  try {
    if (params && params.length > 0) {
      const [rows] = await pool.query(sql, params);
      return rows;
    } else {
      const [rows] = await pool.query(sql);
      return rows;
    }
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a connection from the pool
 * @returns MySQL connection
 */
/**
 * How long to wait for a free pool connection before giving up.
 *
 * mysql2 has NO acquire timeout of its own: with waitForConnections:true and
 * queueLimit:0 it pushes the waiter onto an internal queue with no timer
 * (lib/base/pool.js), so an exhausted pool makes every caller wait FOREVER.
 * That is why pool exhaustion presents as the app silently hanging with
 * nothing in the logs, rather than as an error anyone can act on.
 *
 * Note for anyone tempted to "just set acquireTimeout" in the pool config:
 * mysql2 3.x does not read it. PoolConfig only honours connectionLimit,
 * queueLimit, waitForConnections, maxIdle and idleTimeout — an acquireTimeout
 * key is accepted and silently ignored, which looks like a fix and is not.
 * The timeout has to be enforced out here, around getConnection().
 */
const ACQUIRE_TIMEOUT_MS = parseInt(process.env.DB_ACQUIRE_TIMEOUT_MS || '') || 20_000;

/** Snapshot of pool saturation, for diagnostics. */
export function getPoolStats() {
  // These are mysql2 internals, not public API — read defensively so a version
  // bump degrades the diagnostics instead of breaking callers.
  const internal: any = (pool as any).pool ?? pool;
  const total = internal?._allConnections?.length;
  const free = internal?._freeConnections?.length;
  const queued = internal?._connectionQueue?.length;
  const limit = internal?.config?.connectionLimit;
  return {
    limit: typeof limit === 'number' ? limit : null,
    total: typeof total === 'number' ? total : null,
    free: typeof free === 'number' ? free : null,
    inUse: typeof total === 'number' && typeof free === 'number' ? total - free : null,
    waiting: typeof queued === 'number' ? queued : null,
  };
}

/**
 * Get a connection from the pool
 * @returns MySQL connection
 */
export async function getConnection() {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const pending = pool.getConnection();

  // If the race below is lost to the timeout, this acquisition is still in
  // flight and will eventually be granted a connection that no caller holds a
  // reference to. Release it when it lands, or the timeout itself would leak
  // the very slot it is complaining about and make saturation permanent.
  pending
    .then((conn) => {
      if (timedOut) conn.release();
    })
    .catch(() => {
      // The acquisition failed on its own; the race already rejected or will.
    });

  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          const stats = getPoolStats();
          reject(
            new Error(
              `Timed out after ${ACQUIRE_TIMEOUT_MS}ms waiting for a database connection ` +
                `(limit=${stats.limit}, inUse=${stats.inUse}, waiting=${stats.waiting}). ` +
                `The connection pool is saturated: either DB_POOL_LIMIT is too low for the ` +
                `number of concurrent users, or connections are being held too long or leaked.`
            )
          );
        }, ACQUIRE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute multiple queries within a single transaction
 * @param callback - Function that receives a connection and returns a promise
 */
export async function withTransaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
  // Goes through getConnection() rather than pool.getConnection() so this
  // path — which POS checkout and every other transaction use — gets the
  // acquire timeout too. Calling the pool directly here would let the most
  // important code path hang forever on a saturated pool.
  const connection = await getConnection();
  // beginTransaction() is inside the try/finally because it can fail on its
  // own — a dropped socket to a remote (cloud) MySQL fails here, and a throw
  // before the try block would return to the caller WITHOUT releasing the
  // connection. Each such leak permanently costs the pool one slot, so a run
  // of transient cloud errors ends with every slot leaked and the app hanging
  // on getConnection() forever, with no error to show for it.
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    // A failed rollback must not replace the error that caused it: the
    // original is the diagnosis, and rollback failure is usually just the same
    // dead connection reporting itself a second time. The pool discards a
    // connection whose rollback failed when we release it below.
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Transaction rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}

// Counter helpers accept an optional live transaction connection. When given,
// the increment joins the caller's transaction — one fewer connection + the
// number is released again if the caller rolls back (no gaps on failed sales).
async function onConnection<T>(
  connection: mysql.PoolConnection | undefined,
  work: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  return connection ? work(connection) : withTransaction(work);
}

/**
 * Atomicly gets and increments the next reference number for a given transaction type
 * @param type - The column name in transaction_references table (e.g. 'sales_invoice')
 * @returns The next reference number
 */
export async function getNextReference(type: string, connection?: mysql.PoolConnection): Promise<number> {
  return await onConnection(connection, async (connection) => {
    // 1. Increment the counter
    await connection.query(
      `UPDATE transaction_references SET ${type} = CAST(${type} AS UNSIGNED) + 1 WHERE id = 1`
    );

    // 2. Fetch the new value
    const [rows]: any = await connection.query(
      `SELECT ${type} as next_val FROM transaction_references WHERE id = 1`
    );

    if (!rows || rows.length === 0) {
      throw new Error(`Failed to fetch next reference for ${type}`);
    }

    return parseInt(rows[0].next_val);
  });
}

/**
 * Atomicly gets and increments the next receipt number (OR)
 * @param terminalId - Optional terminal ID. If provided, increments terminal-specific OR.
 * @returns The next receipt number string
 */
export async function getNextReceiptNumber(terminalId?: string, connection?: mysql.PoolConnection): Promise<string> {
  return await onConnection(connection, async (connection) => {
    let nextVal: string;
    
    if (terminalId) {
      // 1. Increment terminal-specific OR
      await connection.query(
        `UPDATE pos_terminals SET or_next_reference = LPAD(IF(or_next_reference IS NULL OR or_next_reference = '', 0, CAST(or_next_reference AS UNSIGNED)) + 1, 6, '0') WHERE id = ?`,
        [terminalId]
      );
      
      // 2. Fetch the new value
      const [rows]: any = await connection.query(
        `SELECT or_next_reference as next_val FROM pos_terminals WHERE id = ?`,
        [terminalId]
      );
      
      if (!rows || rows.length === 0) {
        throw new Error(`Failed to fetch next receipt number for terminal ${terminalId}`);
      }
      nextVal = rows[0].next_val;
    } else {
      // 1. Increment global receipt number
      await connection.query(
        `UPDATE transaction_references SET receipt_number = LPAD(IF(receipt_number IS NULL OR receipt_number = '', 0, CAST(receipt_number AS UNSIGNED)) + 1, 6, '0') WHERE id = 1`
      );
      
      // 2. Fetch the new value
      const [rows]: any = await connection.query(
        `SELECT receipt_number as next_val FROM transaction_references WHERE id = 1`
      );
      
      if (!rows || rows.length === 0) {
        throw new Error(`Failed to fetch global next receipt number`);
      }
      nextVal = rows[0].next_val;
    }
    
    return nextVal;
  });
}

/**
 * Atomically gets and increments the next X-Reading number for a terminal
 * @param terminalId - Terminal ID
 * @returns The next X-Reading number string
 */
export async function getNextXReadingNumber(terminalId: string): Promise<string> {
  return await withTransaction(async (connection) => {
    // 1. Increment terminal-specific X counter
    await connection.query(
      `UPDATE pos_terminals SET x_counter = x_counter + 1 WHERE id = ?`,
      [terminalId]
    );
    
    // 2. Fetch the new value
    const [rows]: any = await connection.query(
      `SELECT x_counter as next_val FROM pos_terminals WHERE id = ?`,
      [terminalId]
    );
    
    if (!rows || rows.length === 0) {
      throw new Error(`Failed to fetch next X-Reading number for terminal ${terminalId}`);
    }
    
    const nextVal = rows[0].next_val;
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    return `X-${dateStr}-${nextVal.toString().padStart(3, '0')}`;
  });
}

/**
 * Atomically gets and increments the next Z-Reading number for a terminal
 * @param terminalId - Terminal ID
 * @returns The next Z-Reading number string
 */
export async function getNextZReadingNumber(terminalId: string): Promise<string> {
  return await withTransaction(async (connection) => {
    // 1. Increment terminal-specific Z counter
    await connection.query(
      `UPDATE pos_terminals SET z_counter = z_counter + 1 WHERE id = ?`,
      [terminalId]
    );
    
    // 2. Fetch the new value
    const [rows]: any = await connection.query(
      `SELECT z_counter as next_val FROM pos_terminals WHERE id = ?`,
      [terminalId]
    );
    
    if (!rows || rows.length === 0) {
      throw new Error(`Failed to fetch next Z-Reading number for terminal ${terminalId}`);
    }
    
    const nextVal = rows[0].next_val;
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    return `Z-${dateStr}-${nextVal.toString().padStart(3, '0')}`;
  });
}

/**
 * Atomically gets and increments the next SI Number (Sales Invoice Number)
 * @returns The next SI number string (plain sequential digits, e.g. "001234")
 */
export async function getNextSINumber(connection?: mysql.PoolConnection): Promise<string> {
  return await onConnection(connection, async (connection) => {
    // 1. Atomically increment the numeric counter.
    await connection.query(
      `UPDATE transaction_references SET si_number = LPAD(IF(si_number IS NULL OR si_number = '', 0, CAST(si_number AS UNSIGNED)) + 1, 6, '0') WHERE id = 1`
    );

    // 2. Read it back.
    const [rows]: any = await connection.query(
      `SELECT si_number as next_val FROM transaction_references WHERE id = 1`
    );
    if (!rows || rows.length === 0) {
      throw new Error('Failed to fetch next SI number');
    }
    return String(rows[0].next_val);
  });
}

/**
 * Atomically gets and increments the next MC Number (Merchandise Credit).
 *
 * Must be called with the SAME connection as the return's INSERT so the number
 * is rolled back with the transaction if the return fails — otherwise the
 * sequence gaps.
 *
 * @returns The next MC number, formatted (e.g. "MC-000001")
 */
export async function getNextMCNumber(connection?: mysql.PoolConnection): Promise<string> {
  return await onConnection(connection, async (connection) => {
    // 1. Atomically increment the numeric counter.
    await connection.query(
      `UPDATE transaction_references SET mc_number = LPAD(IF(mc_number IS NULL OR mc_number = '', 0, CAST(mc_number AS UNSIGNED)) + 1, 6, '0') WHERE id = 1`
    );

    // 2. Read it back.
    const [rows]: any = await connection.query(
      `SELECT mc_number as next_val FROM transaction_references WHERE id = 1`
    );
    if (!rows || rows.length === 0) {
      throw new Error('Failed to fetch next MC number');
    }
    return `MC-${String(rows[0].next_val)}`;
  });
}


/**
 * Atomically gets and increments the next BIR Official Receipt (OR) number.
 *
 * Named bir_or_number (not or_number) to avoid confusion with the existing,
 * unrelated getNextReceiptNumber()/or_next_reference counter, which is a
 * generic per-terminal receipt reference issued for every sale regardless of
 * type — not this BIR classification series.
 *
 * @returns The next BIR OR number, formatted (e.g. "OR-000001")
 */
export async function getNextBirOrNumber(connection?: mysql.PoolConnection): Promise<string> {
  return await onConnection(connection, async (connection) => {
    await connection.query(
      `UPDATE transaction_references SET bir_or_number = LPAD(IF(bir_or_number IS NULL OR bir_or_number = '', 0, CAST(bir_or_number AS UNSIGNED)) + 1, 6, '0') WHERE id = 1`
    );

    const [rows]: any = await connection.query(
      `SELECT bir_or_number as next_val FROM transaction_references WHERE id = 1`
    );
    if (!rows || rows.length === 0) {
      throw new Error('Failed to fetch next BIR OR number');
    }
    return `OR-${String(rows[0].next_val)}`;
  });
}

/**
 * Close the connection pool
 */
export async function closePool() {
  await pool.end();
}
