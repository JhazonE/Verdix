import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveReturnApprover, writeReturnApprover } from '../../lib/return-approver';

// A fake connection: answers the users lookup and records writes.
const users: Record<string, { uid: string; display_name: string | null; username: string }> = {
  'u-1': { uid: 'u-1', display_name: 'Maria Santos', username: 'maria' },
  'u-2': { uid: 'u-2', display_name: null, username: 'jun' },
};
const writes: any[][] = [];
const conn = {
  async query(sql: string, params: any[] = []) {
    if (sql.startsWith('SELECT')) return [users[params[0]] ? [users[params[0]]] : []];
    writes.push(params);
    return [{}];
  },
};

(async () => {
  // A real user: the DB's current name is recorded, not the one sent.
  assert.deepEqual(
    await resolveReturnApprover(conn, { approvedByUserId: 'u-1', approvedByName: 'typed' }),
    { userId: 'u-1', name: 'Maria Santos' });
  assert.deepEqual(
    await resolveReturnApprover(conn, { approvedByUserId: 'u-2' }),
    { userId: 'u-2', name: 'jun' }, 'falls back to the username');
  // An id naming no user is dropped; the name sent is kept.
  assert.deepEqual(
    await resolveReturnApprover(conn, { approvedByUserId: 'ghost', approvedByName: 'supervisor' }),
    { userId: null, name: 'supervisor' });
  // Fixed return credentials: no account, the configured username.
  assert.deepEqual(
    await resolveReturnApprover(conn, { approvedByUserId: null, approvedByName: '  supervisor ' }),
    { userId: null, name: 'supervisor' });
  // Nothing sent (return auth off), blanks and non-strings mean no approver.
  for (const body of [{}, { approvedByName: '   ' }, { approvedByName: 42 }, { approvedByUserId: {} }]) {
    assert.deepEqual(await resolveReturnApprover(conn, body as any), { userId: null, name: null });
  }
  assert.equal((await resolveReturnApprover(conn, { approvedByName: 'x'.repeat(300) })).name!.length, 100);

  // No approver writes nothing; one approver writes both columns.
  await writeReturnApprover(conn, 'RTN-1', { userId: null, name: null });
  assert.equal(writes.length, 0);
  await writeReturnApprover(conn, 'RTN-1', { userId: null, name: 'supervisor' });
  assert.deepEqual(writes[0], [null, 'supervisor', 'RTN-1']);

  // Wiring: both return writers record it, outside the transaction's ALTER risk,
  // and the POS sends it from the authorization prompt.
  const read = (p: string) => readFileSync(p, 'utf8');
  for (const route of ['app/api/sales/returns/route.ts', 'app/api/sales/exchanges/route.ts']) {
    const src = read(route);
    assert.ok(src.indexOf('ensureReturnApproverColumns()') < src.indexOf('withTransaction(async'),
      `${route}: the column check must run before the transaction`);
    assert.ok(src.includes('writeReturnApprover(connection'), `${route} must record the approver`);
  }
  const hook = read('app/(app)/pos/return-sales/use-return-sales.ts');
  assert.equal((hook.match(/approvedByName: approverRef\.current/g) || []).length, 2,
    'the return and the exchange request both carry the approver');
  assert.ok(read('app/(app)/reports/sales/returns/page.tsx').includes('overrideBy: tx.approvedByName'),
    'Override By reads the recorded approver');

  console.log('✓ return-approver');
  // Not process.exit(0): it kills run.ts mid-import (unit-runner note).
})().catch((e) => { console.error(e); process.exitCode = 1; throw e; });
