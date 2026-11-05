import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  nextPaymentReference,
  PAYMENT_REFERENCE_ATTEMPTS,
} from '../../lib/payment-reference';

// Two cashiers recording a customer payment at the same moment lost one of
// the payments.
//
// Root cause: both writers derived the reference with
//     SELECT MAX(CAST(reference AS UNSIGNED)) ... ; nextRef = max + 1
// and then inserted without any retry. Verified against this database:
//   - transaction_isolation is REPEATABLE-READ, where that bare aggregate
//     takes no lock preventing a second transaction from reading the same MAX
//   - customer_payments.reference carries a UNIQUE index (INDEX_NAME
//     'reference', NON_UNIQUE 0)
// Reproduced on a temp table with the real schema shape: two actors reading
// before either wrote both computed '000006'; the second INSERT failed with
// ER_DUP_ENTRY. The customer had handed over money and nothing was recorded.
//
// This project runs one server per physical terminal against a shared
// database, so concurrent writers are the normal case.
//
// Also verified: a duplicate-key error does NOT poison the surrounding
// transaction in MySQL — after catching ER_DUP_ENTRY, a subsequent INSERT on
// the same connection succeeded and COMMIT persisted both rows. That is what
// makes retrying inside the payment transaction sound rather than requiring
// the whole transaction to restart.

// The suite compiles to CJS, which has no top-level await, and run.ts expects
// each test file to be a side-effecting async IIFE that throws on failure.
(async () => {
  /** A connection stub: `taken` is the set of references already in the table. */
  function fakeConnection(taken: Set<string>, opts: { onInsert?: () => void } = {}) {
    let maxReads = 0;
    return {
      maxReads: () => maxReads,
      async query(sql: string, values?: any[]) {
        if (/MAX\(CAST/i.test(sql)) {
          maxReads++;
          const numeric = [...taken]
            .filter((r) => /^[0-9]+$/.test(r))
            .map((r) => parseInt(r, 10));
          const max = numeric.length ? Math.max(...numeric) : null;
          return [[{ max_ref: max }]];
        }
        if (/SELECT id FROM customer_payments WHERE reference/i.test(sql)) {
          const ref = values?.[0];
          return [taken.has(ref) ? [{ id: 'existing' }] : []];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      /** Mimics the UNIQUE index on reference. */
      insert(ref: string) {
        opts.onInsert?.();
        if (taken.has(ref)) {
          const err: any = new Error(`Duplicate entry '${ref}' for key 'reference'`);
          err.code = 'ER_DUP_ENTRY';
          err.errno = 1062;
          throw err;
        }
        taken.add(ref);
      },
    };
  }

  // ─── the happy path ──────────────────────────────────────────────────────
  {
    const taken = new Set(['000005']);
    const c = fakeConnection(taken);
    const ref = await nextPaymentReference(c, undefined, async (r) => c.insert(r));
    assert.equal(ref, '000006', 'the next reference follows the highest existing one');
    assert.ok(taken.has('000006'), 'and it is the reference actually inserted');
  }

  // An empty table starts at 000001, not 000000 or NaN.
  {
    const taken = new Set<string>();
    const c = fakeConnection(taken);
    const ref = await nextPaymentReference(c, undefined, async (r) => c.insert(r));
    assert.equal(ref, '000001', 'the first ever payment is 000001');
  }

  // ─── the race: a taken number must be stepped over, not failed on ────────
  {
    // '000006' was committed by a competing transaction after our MAX read.
    const taken = new Set(['000005']);
    let inserts = 0;
    const c = fakeConnection(taken, {
      onInsert: () => {
        inserts++;
        // On the first attempt only, simulate the competitor landing first.
        if (inserts === 1) taken.add('000006');
      },
    });
    const ref = await nextPaymentReference(c, undefined, async (r) => c.insert(r));
    assert.equal(
      ref,
      '000007',
      'losing the race yields the NEXT free reference instead of failing the ' +
        'payment — this is the case where a customer paid and nothing was recorded',
    );
    assert.ok(c.maxReads() > 1, 'the maximum is re-read on retry, not reused');
  }

  // Forward progress must not depend on the re-read maximum moving.
  //
  // Under REPEATABLE-READ the competitor's committed row is often NOT visible
  // to this transaction's snapshot, so MAX comes back unchanged on every
  // retry. A candidate of `max + 1` would then be the same number forever.
  // The allocator must step past what it last tried regardless.
  {
    const taken = new Set(['000005']);
    let inserts = 0;
    const c = {
      async query(sql: string) {
        if (/MAX\(CAST/i.test(sql)) {
          // Frozen snapshot: always reports 5, however many rows land.
          return [[{ max_ref: 5 }]];
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const ref = await nextPaymentReference(c, undefined, async (r) => {
      inserts++;
      // 000006 is taken by a competitor this snapshot cannot see.
      if (r === '000006') {
        const err: any = new Error(`Duplicate entry '${r}'`);
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      taken.add(r);
    });
    assert.equal(
      ref,
      '000007',
      'with a frozen MAX the allocator still advances, rather than retrying ' +
        'the same reference until the attempt budget runs out',
    );
    assert.equal(inserts, 2, 'it took exactly one extra attempt to get there');
  }

  // A whole run of taken numbers is walked past.
  {
    const taken = new Set(['000005', '000006', '000007', '000008']);
    const c = fakeConnection(taken);
    const ref = await nextPaymentReference(c, undefined, async (r) => c.insert(r));
    assert.equal(ref, '000009', 'contiguous taken references are skipped');
  }

  // ─── a caller-supplied reference is NEVER silently changed ───────────────
  // Writing a different number would file the payment under a reference that
  // does not match the paper receipt in the customer's hand.
  {
    const taken = new Set(['INV-900']);
    const c = fakeConnection(taken);
    await assert.rejects(
      () => nextPaymentReference(c, 'INV-900', async (r) => c.insert(r)),
      /Reference already exists/,
      'a duplicate user-typed reference is reported, not quietly renumbered',
    );
  }
  {
    const taken = new Set<string>();
    const c = fakeConnection(taken);
    const ref = await nextPaymentReference(c, 'OR-123', async (r) => c.insert(r));
    assert.equal(ref, 'OR-123', 'a free user-typed reference is used verbatim');
    assert.ok(taken.has('OR-123'), 'and inserted as given');
  }

  // ─── non-duplicate errors must propagate ─────────────────────────────────
  // Retrying through a real failure (a dead connection, a constraint violation
  // on another column) would hide it and burn the attempt budget.
  {
    const c = fakeConnection(new Set(['000001']));
    await assert.rejects(
      () =>
        nextPaymentReference(c, undefined, async () => {
          const err: any = new Error('Connection lost');
          err.code = 'PROTOCOL_CONNECTION_LOST';
          throw err;
        }),
      /Connection lost/,
      'an unrelated error is surfaced immediately rather than retried',
    );
  }

  // ─── the retry budget is finite and reports honestly ─────────────────────
  {
    let attempts = 0;
    const c = fakeConnection(new Set(['000001']));
    await assert.rejects(
      () =>
        // Counted here, not via onInsert: this case supplies its own always-
        // failing insert and never reaches the stub's.
        nextPaymentReference(c, undefined, async () => {
          attempts++;
          const err: any = new Error('Duplicate entry');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }),
      /Could not allocate a unique payment reference/,
      'an unwinnable race fails loudly instead of looping forever',
    );
    assert.equal(
      attempts,
      PAYMENT_REFERENCE_ATTEMPTS,
      'it gives up after exactly the declared number of attempts',
    );
  }

  // ─── both writers use it ─────────────────────────────────────────────────
  // Fixing one route and leaving the other is the bug again: they write the
  // same column with the same UNIQUE index.
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8').replace(/\r\n/g, '\n');

  for (const rel of [
    'app/api/customer-payments/route.ts',
    'app/api/customers/invoices/[id]/payment/route.ts',
  ]) {
    const src = read(rel);
    assert.ok(
      /from ['"]@\/lib\/payment-reference['"]/.test(src),
      `${rel} allocates its payment reference through lib/payment-reference`,
    );
    // The specific regression: computing the next reference inline again.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    assert.ok(
      !/MAX\(CAST\(reference/i.test(code),
      `${rel} no longer derives the reference with a bare MAX(CAST(reference)) ` +
        'read, which races under REPEATABLE-READ against a UNIQUE index',
    );
  }

  console.log('✓ payment-reference');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
