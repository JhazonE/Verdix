import assert from 'node:assert/strict';
import { fetchReport, ReportFetchError } from '../../lib/fetch-report';

// The report pages' hand-rolled fetches turned several distinct failures into
// "no data": a 200 with success:false set no rows and showed no message, and a
// request that never answered just span forever. fetchReport must make every
// one of those an error a caller's catch/toast can report.
//
// Stubs are INJECTED via fetchImpl, never assigned to globalThis.fetch: run.ts
// imports every test file into one process and they execute concurrently, so a
// swapped global leaks into whichever other test is mid-request. Doing that
// here made the Sta. Lucia client test receive this file's fake responses for
// its real HTTP calls.

const expectError = async (fn: () => Promise<unknown>): Promise<any> => {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  assert.fail('expected a rejection');
};

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const text = (body: string, status = 200) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

// A fetch that only ever ends by being aborted.
const neverSettles = ((_url: any, init: any) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')));
  })) as unknown as typeof fetch;

export const fetchReportTest = (async () => {
  // Node exits as soon as nothing holds the loop open, and a bare pending
  // promise does not. Without a live timer the process would exit before
  // AbortSignal.timeout's timer ran and the timeout case below would never be
  // asserted (the test would "pass" in silence). Cleared in the finally.
  const keepAlive = setInterval(() => {}, 1000);

  try {
    // Happy path: unwraps the envelope's `data`.
    const rows = await fetchReport<any[]>('http://x/r', { fetchImpl: json({ success: true, data: [{ id: 1 }] }) });
    assert.deepEqual(rows, [{ id: 1 }], 'returns the envelope data');

    // success:false must THROW, carrying `details` — the case that silently
    // rendered as an empty report.
    {
      const e = await expectError(() =>
        fetchReport('http://x/r', {
          fetchImpl: json({ success: false, error: 'Failed to fetch', details: 'Unknown column x' }),
        })
      );
      assert.ok(e instanceof ReportFetchError, 'a 200 with success:false is an error');
      assert.match(e.message, /Unknown column x/, 'surfaces the API details, got: ' + e.message);
    }

    // success:false with no details still throws something usable.
    {
      const e = await expectError(() => fetchReport('http://x/r', { fetchImpl: json({ success: false }) }));
      assert.match(e.message, /could not be generated/, 'has a fallback message, got: ' + e.message);
    }

    // A non-OK status throws and records the status.
    {
      const e = await expectError(() => fetchReport('http://x/r', { fetchImpl: text('nope', 500) }));
      assert.equal(e.status, 500, 'keeps the HTTP status');
      assert.match(e.message, /HTTP 500/, 'names the status, got: ' + e.message);
    }

    // Unreadable body throws rather than yielding undefined rows.
    {
      const e = await expectError(() =>
        fetchReport('http://x/r', { fetchImpl: text('<html>not json</html>') })
      );
      assert.match(e.message, /could not be read/, 'reports an unreadable body, got: ' + e.message);
    }

    // A request that never answers must TIME OUT, not hang — the actual bug.
    {
      const t0 = Date.now();
      const e = await expectError(() =>
        fetchReport('http://x/r', { fetchImpl: neverSettles, timeoutMs: 300 })
      );
      const waited = Date.now() - t0;
      assert.ok(e instanceof ReportFetchError, `a hung request becomes a ReportFetchError, got ${e?.name}`);
      assert.equal(e.timedOut, true, 'flagged as a timeout');
      assert.match(e.message, /timed out/, 'says it timed out, got: ' + e.message);
      assert.ok(waited >= 250, `waited for the budget, only ${waited}ms`);
      assert.ok(waited < 3000, `gives up promptly, waited ${waited}ms`);
    }

    // A caller's own cancellation is NOT a report failure: a superseded query
    // or an unmounted component is nothing to toast about.
    {
      const ac = new AbortController();
      const p = fetchReport('http://x/r', { fetchImpl: neverSettles, signal: ac.signal, timeoutMs: 10_000 });
      ac.abort();
      const e = await expectError(() => p);
      assert.ok(!(e instanceof ReportFetchError), `caller cancellation is not a ReportFetchError, got ${e?.name}`);
    }

    // A route returning a bare payload (no envelope) is passed through.
    {
      const bare = await fetchReport<number[]>('http://x/r', { fetchImpl: json([1, 2, 3]) });
      assert.deepEqual(bare, [1, 2, 3], 'passes through a non-enveloped payload');
    }

    console.log('✓ fetch-report');
  } finally {
    clearInterval(keepAlive);
  }
})().catch((e) => {
  console.error('fetch-report test failed:', e);
  process.exitCode = 1;
});
