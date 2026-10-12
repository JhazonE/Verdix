import assert from 'node:assert/strict';
import {
  computeUntrackedQuantity,
  resolveExpirationEdits,
} from '../../lib/batch-expiration-edit';

// Expiry lives on inventory_batches, not on products — products.expiration_date
// is only a denormalized cache of the soonest batch still in stock (see
// lib/expiration.ts). These assertions pin the logic that lets Stock Levels edit
// those batch dates WITHOUT moving any stock.

{
  // The gap this feature exists to close: migration 100 deliberately did not
  // backfill historical batches, and adjustStock only creates a batch when
  // quantity > 0. So a product can hold stock with NO batch rows at all — for
  // those, there is nothing to attach a date to, and the dialog would be empty.
  assert.equal(
    computeUntrackedQuantity(100, []),
    100,
    'stock with no batches at all is entirely untracked'
  );
}

{
  // Partial coverage: batches account for some of the stock, the rest is not
  // represented in the batch ledger.
  assert.equal(
    computeUntrackedQuantity(100, [{ quantityRemaining: 30 }, { quantityRemaining: 20 }]),
    50,
    'untracked is stock minus the sum of remaining batch quantities'
  );
}

{
  // Fully covered stock has no remainder, so no opening batch may be offered.
  assert.equal(
    computeUntrackedQuantity(50, [{ quantityRemaining: 30 }, { quantityRemaining: 20 }]),
    0,
    'fully covered stock leaves nothing untracked'
  );
}

{
  // Batches can over-cover stock (a transfer or correction moved products.stock
  // down without depleting batches). A negative remainder must never be offered
  // as an opening batch — it would insert a negative quantity_in.
  assert.equal(
    computeUntrackedQuantity(10, [{ quantityRemaining: 30 }]),
    0,
    'over-covered stock clamps to zero, never negative'
  );
}

{
  // mysql2 returns DECIMAL columns as strings; `-` against a string coerces but
  // a sum with `+` would concatenate. Both inputs must be coerced.
  assert.equal(
    computeUntrackedQuantity('100' as unknown as number, [
      { quantityRemaining: '30' as unknown as number },
      { quantityRemaining: '20' as unknown as number },
    ]),
    50,
    'string DECIMALs from mysql2 are coerced, not concatenated'
  );
}

{
  // Exhausted batches hold no stock, so they do not reduce the untracked
  // remainder and must not be editable targets either.
  assert.equal(
    computeUntrackedQuantity(40, [{ quantityRemaining: 0 }, { quantityRemaining: 10 }]),
    30,
    'exhausted batches contribute nothing to coverage'
  );
}

{
  // A plain date edit on an existing batch: one update, no new batch.
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [{ batchId: 'B1', expirationDate: '2026-12-01' }],
  });

  assert.deepEqual(
    result.batchUpdates,
    [{ batchId: 'B1', expirationDate: '2026-12-01' }],
    'an existing batch is updated in place'
  );
  assert.equal(result.openingBatch, null, 'no opening batch when stock is covered');
  assert.deepEqual(result.rejected, [], 'a valid edit is not rejected');
}

{
  // Blank clears the date. Expiry is optional, so "no date" is a real answer —
  // it must reach the column as NULL, not be dropped as a no-op.
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [{ batchId: 'B1', expirationDate: '' }],
  });

  assert.deepEqual(
    result.batchUpdates,
    [{ batchId: 'B1', expirationDate: null }],
    'a blank date clears the expiry to NULL'
  );
}

{
  // A batch id that does not belong to this product must be rejected, not
  // updated — the batch ids come from the browser.
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [{ batchId: 'SOMEONE-ELSES-BATCH', expirationDate: '2026-12-01' }],
  });

  assert.deepEqual(result.batchUpdates, [], 'a foreign batch id is never updated');
  assert.deepEqual(
    result.rejected,
    ['SOMEONE-ELSES-BATCH'],
    'the foreign batch id is reported as rejected'
  );
}

{
  // An exhausted batch is not an editable target: it drives nothing (the
  // expiring-soon report and the expiration cache both require
  // quantity_remaining > 0), so editing it would be a silent no-op.
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 0 }, { id: 'B2', quantityRemaining: 10 }],
    updates: [{ batchId: 'B1', expirationDate: '2026-12-01' }],
  });

  assert.deepEqual(result.batchUpdates, [], 'an exhausted batch is not editable');
  assert.deepEqual(result.rejected, ['B1'], 'the exhausted batch is reported as rejected');
}

{
  // Malformed dates are normalized away rather than written as garbage into a
  // column the expiring-soon report reads. normalizeExpirationDate returns null
  // for unparseable input, which here means "clear it".
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [{ batchId: 'B1', expirationDate: 'not-a-date' }],
  });

  assert.deepEqual(
    result.batchUpdates,
    [{ batchId: 'B1', expirationDate: null }],
    'unparseable input normalizes to NULL, never to garbage'
  );
}

{
  // Non-ISO but real dates still normalize to a MySQL DATE literal, and must do
  // so without a UTC day-shift in UTC+8 (Philippines).
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [{ batchId: 'B1', expirationDate: '2026-12-01T00:00:00' }],
  });

  assert.deepEqual(
    result.batchUpdates,
    [{ batchId: 'B1', expirationDate: '2026-12-01' }],
    'an ISO timestamp keeps its calendar date (no UTC shift)'
  );
}

{
  // The untracked case: stock exists with no batch to hold a date, so setting
  // an expiry must produce an opening batch covering exactly the uncovered
  // quantity. This records existing stock in the batch ledger — it does NOT
  // change products.stock.
  const result = resolveExpirationEdits({
    productStock: 100,
    batches: [{ id: 'B1', quantityRemaining: 40 }],
    updates: [],
    untrackedExpiration: '2026-12-01',
  });

  assert.equal(result.openingBatch?.quantity, 60, 'the opening batch covers only the gap');
  assert.equal(
    result.openingBatch?.expirationDate,
    '2026-12-01',
    'the opening batch carries the requested date'
  );
  assert.deepEqual(result.batchUpdates, [], 'no existing batch was touched');
}

{
  // No untracked stock means no opening batch, even if a date was supplied —
  // inserting one would double-count stock in the batch ledger and corrupt FIFO.
  const result = resolveExpirationEdits({
    productStock: 40,
    batches: [{ id: 'B1', quantityRemaining: 40 }],
    updates: [],
    untrackedExpiration: '2026-12-01',
  });

  assert.equal(
    result.openingBatch,
    null,
    'fully covered stock never creates an opening batch, even with a date'
  );
}

{
  // An untracked date that is blank/unparseable creates nothing — there is no
  // reason to register stock in the batch ledger without the date that was the
  // whole point of the edit.
  for (const bad of ['', '   ', 'not-a-date', null, undefined]) {
    const result = resolveExpirationEdits({
      productStock: 100,
      batches: [],
      updates: [],
      untrackedExpiration: bad as string | null | undefined,
    });
    assert.equal(
      result.openingBatch,
      null,
      `no opening batch for a blank/invalid untracked date (${JSON.stringify(bad)})`
    );
  }
}

{
  // Zero stock has nothing to track at all.
  const result = resolveExpirationEdits({
    productStock: 0,
    batches: [],
    updates: [],
    untrackedExpiration: '2026-12-01',
  });

  assert.equal(result.openingBatch, null, 'a product with no stock creates no opening batch');
}

{
  // Edits and an opening batch can arrive together, and both must be applied.
  const result = resolveExpirationEdits({
    productStock: 100,
    batches: [{ id: 'B1', quantityRemaining: 40 }],
    updates: [{ batchId: 'B1', expirationDate: '2026-11-15' }],
    untrackedExpiration: '2026-12-01',
  });

  assert.deepEqual(result.batchUpdates, [{ batchId: 'B1', expirationDate: '2026-11-15' }]);
  assert.equal(result.openingBatch?.quantity, 60);
}

{
  // The same batch sent twice must not produce two conflicting UPDATEs — the
  // last value wins, deterministically.
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [
      { batchId: 'B1', expirationDate: '2026-11-15' },
      { batchId: 'B1', expirationDate: '2026-12-01' },
    ],
  });

  assert.deepEqual(
    result.batchUpdates,
    [{ batchId: 'B1', expirationDate: '2026-12-01' }],
    'a duplicated batch id collapses to one update, last value winning'
  );
}

{
  // Nothing to do at all is a valid, non-failing request.
  const result = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [],
  });

  assert.equal(result.hasWork, false, 'an empty request reports no work');
  assert.deepEqual(result.batchUpdates, []);
  assert.equal(result.openingBatch, null);
}

{
  // A request with work reports so, which is what lets the route skip opening a
  // transaction for a no-op save.
  const withUpdate = resolveExpirationEdits({
    productStock: 10,
    batches: [{ id: 'B1', quantityRemaining: 10 }],
    updates: [{ batchId: 'B1', expirationDate: '2026-12-01' }],
  });
  assert.equal(withUpdate.hasWork, true, 'a batch update counts as work');

  const withOpening = resolveExpirationEdits({
    productStock: 100,
    batches: [],
    updates: [],
    untrackedExpiration: '2026-12-01',
  });
  assert.equal(withOpening.hasWork, true, 'an opening batch counts as work');
}

console.log('✓ batch-expiration-edit');

// The Set Expiration dialog is a client component, so it imports
// computeUntrackedQuantity into the BROWSER bundle. This module must therefore
// stay free of any transitive dependency on lib/mysql — importing the MySQL
// driver client-side fails the webpack build outright ("Can't resolve 'tls'").
// Asserting on the source keeps the boundary from silently regressing: the
// expiry DATE helpers are pure, but they used to live beside the DB-touching
// cache refresh in lib/expiration.
{
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');

  const seen = new Set<string>();
  const offenders: string[] = [];

  const walk = (fileRelativeToLib: string) => {
    const abs = path.join(__dirname, '../../lib', fileRelativeToLib);
    const resolved = fs.existsSync(abs) ? abs : `${abs}.ts`;
    if (seen.has(resolved) || !fs.existsSync(resolved)) return;
    seen.add(resolved);

    const src = fs.readFileSync(resolved, 'utf8');
    for (const m of src.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
      const spec = m[1];
      if (/\/mysql$|^\.\/mysql$/.test(spec)) {
        offenders.push(`${path.basename(resolved)} imports ${spec}`);
        continue;
      }
      walk(path.join(path.dirname(fileRelativeToLib), spec));
    }
  };

  walk('batch-expiration-edit.ts');

  assert.deepEqual(
    offenders,
    [],
    `lib/batch-expiration-edit must not reach lib/mysql (client bundle): ${offenders.join(', ')}`
  );
}
