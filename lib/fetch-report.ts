/**
 * Shared fetch for report endpoints.
 *
 * Every report page used to hand-roll this, and the hand-rolled version had
 * the same two holes in all ~25 of them:
 *
 *  1. No timeout. fetch() has none of its own, so a route that never answers
 *     (a saturated connection pool used to hang one forever with no error and
 *     no log line) left the page on its loading state indefinitely. Users
 *     reported this as the report "not displaying".
 *
 *  2. `if (result.success) { setRows(result.data) }` with no else. A 200
 *     carrying success:false — which is how these APIs report their own
 *     errors, complete with a `details` field — fell straight through: no
 *     rows, no message, a blank report indistinguishable from "no data in
 *     this date range".
 *
 * Throwing on both means a caller's existing catch/toast actually fires, and
 * a report that failed can no longer be mistaken for a report that is empty.
 */

/**
 * Long enough for a wide date range against a remote (cloud) MySQL, short
 * enough that a wedged request reports itself while the user is still
 * watching. Callers with a cashier waiting at a terminal should pass less.
 */
export const REPORT_FETCH_TIMEOUT_MS = 45_000;

export class ReportFetchError extends Error {
  readonly status?: number;
  readonly timedOut: boolean;

  constructor(message: string, options: { status?: number; timedOut?: boolean } = {}) {
    super(message);
    this.name = 'ReportFetchError';
    this.status = options.status;
    this.timedOut = options.timedOut ?? false;
  }
}

export interface FetchReportOptions {
  /** Overrides REPORT_FETCH_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Caller's own abort signal; honoured alongside the timeout. */
  signal?: AbortSignal;
  /**
   * Injectable fetch, for tests. Tests must pass their stub here rather than
   * assigning globalThis.fetch: the unit suite imports every test file into
   * ONE process and they run concurrently, so a swapped global leaks into
   * whichever other test is mid-request (it broke the Sta. Lucia client test,
   * whose real HTTP call started receiving another test's fake response).
   */
  fetchImpl?: typeof fetch;
}

/**
 * GETs a report endpoint and returns its `data`, throwing on every failure
 * mode rather than returning an empty result for any of them.
 *
 * @param url - Full URL, normally from getApiUrl().
 */
export async function fetchReport<T>(url: string, options: FetchReportOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? REPORT_FETCH_TIMEOUT_MS;

  // AbortSignal.any lets a caller's own signal (component unmount, a newer
  // query superseding this one) cancel the request without discarding the
  // timeout, instead of the two competing.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  const doFetch = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, { signal });
  } catch (e) {
    // A timeout and a caller's cancellation both surface as an abort, so ask
    // the timeout signal which one it was: only the first is worth reporting
    // to the user as a failure they can retry.
    if (timeoutSignal.aborted) {
      throw new ReportFetchError(
        `The report request timed out after ${Math.round(timeoutMs / 1000)}s. ` +
          `The server may be overloaded — please try again, or narrow the date range.`,
        { timedOut: true }
      );
    }
    if (options.signal?.aborted) throw e;
    throw new ReportFetchError(
      e instanceof Error ? `Could not reach the server: ${e.message}` : 'Could not reach the server.'
    );
  }

  if (!res.ok) {
    throw new ReportFetchError(`The server returned an error (HTTP ${res.status}).`, { status: res.status });
  }

  let result: any;
  try {
    result = await res.json();
  } catch {
    throw new ReportFetchError('The server returned a response that could not be read.', { status: res.status });
  }

  // `success` is this codebase's envelope. A response without it is passed
  // through as-is so routes that return a bare payload still work.
  if (result && typeof result === 'object' && 'success' in result) {
    if (!result.success) {
      throw new ReportFetchError(
        result.details || result.error || 'The report could not be generated.',
        { status: res.status }
      );
    }
    return result.data as T;
  }

  return result as T;
}
