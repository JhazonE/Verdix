import assert from 'node:assert/strict';
import { isPermanentSyncError } from '../../lib/services/external-accounting-api';

// The case this exists for: a decommissioned endpoint answered 404 and the
// sweep re-sent the same purchase order 21,490 times between April and
// October because nothing classified the failure as hopeless.
assert.equal(
  isPermanentSyncError('HTTP 404: Application not found'),
  true,
  '404 from a dead endpoint is permanent',
);

// Rejections that need a human, not another attempt.
assert.equal(isPermanentSyncError('HTTP 400: Bad Request'), true, '400 is permanent');
assert.equal(isPermanentSyncError('HTTP 401: Unauthorized'), true, '401 is permanent');
assert.equal(isPermanentSyncError('HTTP 403: Forbidden'), true, '403 is permanent');
assert.equal(isPermanentSyncError('HTTP 405: Method Not Allowed'), true, '405 is permanent');
assert.equal(isPermanentSyncError('HTTP 410: Gone'), true, '410 is permanent');
assert.equal(isPermanentSyncError('HTTP 422: Unprocessable Entity'), true, '422 is permanent');

// The whole point of a retry queue — these must stay retryable.
assert.equal(isPermanentSyncError('HTTP 500: Internal Server Error'), false, '500 is retryable');
assert.equal(isPermanentSyncError('HTTP 502: Bad Gateway'), false, '502 is retryable');
assert.equal(isPermanentSyncError('HTTP 503: Service Unavailable'), false, '503 is retryable');
assert.equal(isPermanentSyncError('HTTP 504: Gateway Timeout'), false, '504 is retryable');
assert.equal(isPermanentSyncError('HTTP 408: Request Timeout'), false, '408 is retryable');
assert.equal(isPermanentSyncError('HTTP 429: Too Many Requests'), false, '429 is rate limiting, retryable');

// A network failure never reaches an HTTP status; it must stay retryable, or
// one flaky moment would permanently abandon a real transaction.
assert.equal(isPermanentSyncError('fetch failed'), false, 'network error is retryable');
assert.equal(isPermanentSyncError('The operation was aborted due to timeout'), false, 'timeout is retryable');
assert.equal(isPermanentSyncError(undefined), false, 'missing message is retryable');
assert.equal(isPermanentSyncError(''), false, 'empty message is retryable');

// Only a leading status counts — a 404 quoted inside someone's prose must not
// abandon a row that actually failed for another reason.
assert.equal(
  isPermanentSyncError('Upstream said something about 404 earlier'),
  false,
  'status must be the leading token, not mentioned in passing',
);
assert.equal(isPermanentSyncError('HTTP 4040: weird'), false, 'does not match a 4-digit status');

console.log('sync-permanent-error: all assertions passed');
