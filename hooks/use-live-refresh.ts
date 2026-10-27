/**
 * use-live-refresh.ts
 *
 * A shared hook that subscribes to system-wide "stock-updated" events and
 * calls the provided refetch function.
 *
 * Three transports, because each covers a case the others cannot:
 *   1. Window events   — same tab, synchronous, zero latency.
 *   2. BroadcastChannel — other tabs of the same browser.
 *   3. Server-Sent Events — other MACHINES.
 *
 * (3) is the one that matters for this deployment. Several terminals share a
 * single database and the back office is also opened from a second PC over
 * the LAN, but BroadcastChannel never leaves the browser that posted to it,
 * so before SSE a product saved on one machine stayed stale on every other
 * one until a manual reload.
 */
import { useEffect, useRef } from 'react';
import { getApiUrl } from '@/lib/api-config';

// Use a unique channel name for the app
const CHANNEL_NAME = 'stock-pilot-updates';
const RECONNECT_DELAY_MS = 5000;

/**
 * ONE EventSource for the whole tab, shared by every useLiveRefresh caller.
 *
 * This hook is mounted by ~20 different data hooks (see hooks/use-api.ts), and
 * opening an EventSource per caller meant a single back-office page held ~22
 * SSE streams open at once. Browsers allow only about six concurrent HTTP/1.1
 * connections per origin and an SSE stream never completes, so the pool was
 * permanently exhausted: every later request — including Server Action POSTs —
 * sat queued in the browser and was never put on the wire. That looked exactly
 * like a hung server (an awaited action that never settles, no request in the
 * network panel, no entry in the server log), and it is why inline "+ Add
 * Brand"/"Add Category" could spin forever without ever writing a row.
 *
 * The stream is reference-counted: opened on the first subscriber, closed when
 * the last one unmounts.
 */
let sharedSource: EventSource | null = null;
let sharedRefCount = 0;
let sharedReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

const openSharedSource = () => {
  if (sharedSource || sharedRefCount === 0) return;
  try {
    const source = new EventSource(getApiUrl('/live-events'));
    sharedSource = source;
    source.addEventListener('stock-updated', notifyListeners);
    source.onerror = () => {
      // EventSource retries on its own for a dropped connection, but not for
      // one that errored before opening (server restarted, terminal asleep).
      // Closing and re-opening on a timer covers both without stacking two
      // retry loops.
      source.close();
      if (sharedSource === source) sharedSource = null;
      if (sharedRefCount === 0) return;
      if (sharedReconnectTimer) clearTimeout(sharedReconnectTimer);
      sharedReconnectTimer = setTimeout(openSharedSource, RECONNECT_DELAY_MS);
    };
  } catch {
    // No EventSource (or a blocked URL) — polling remains the fallback.
  }
};

const releaseSharedSource = () => {
  if (sharedRefCount > 0) return;
  if (sharedReconnectTimer) {
    clearTimeout(sharedReconnectTimer);
    sharedReconnectTimer = null;
  }
  sharedSource?.close();
  sharedSource = null;
};

/**
 * Subscribes to 'stock-updated' events via Window Events (same-tab),
 * BroadcastChannel (cross-tab) and SSE (cross-machine) to call refetch
 * automatically.
 */
export function useLiveRefresh(refetch: () => void) {
  // Callers overwhelmingly pass an inline arrow or a react-query refetch,
  // neither of which is referentially stable. Keeping the latest one in a ref
  // means the effect below depends on nothing, so a parent re-render can no
  // longer tear down and re-open the EventSource — which at one refetch per
  // sale would have reconnected constantly.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    const run = () => refetchRef.current();

    // 1. Same-tab listener (fastest)
    window.addEventListener('stock-updated', run);

    // 2. Cross-tab listener (BroadcastChannel)
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data === 'stock-updated') run();
      };
    } catch {
      // Not supported — the other two transports still apply.
    }

    // 3. Cross-machine listener (SSE) — joins the tab's single shared stream
    // rather than opening one per caller. See the comment on sharedSource.
    listeners.add(run);
    sharedRefCount += 1;
    openSharedSource();

    return () => {
      window.removeEventListener('stock-updated', run);
      channel?.close();
      listeners.delete(run);
      sharedRefCount -= 1;
      releaseSharedSource();
    };
  }, []);
}

/**
 * Dispatches a system-wide 'stock-updated' event to trigger auto-refresh
 * in all listening modules — this tab, other tabs, and other terminals.
 */
export function dispatchStockUpdate() {
  // Dispatch in current tab
  window.dispatchEvent(new Event('stock-updated'));

  // Dispatch to other tabs
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage('stock-updated');
    channel.close();
  } catch {
    // Fallback for older browsers or restricted environments
  }

  // Dispatch to other machines. Fire-and-forget on purpose: the write that
  // triggered this has already committed, so a failure to notify is a
  // staleness question (covered by polling), never a correctness one, and
  // must not surface as an error on a save that actually succeeded.
  try {
    void fetch(getApiUrl('/live-events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'stock-updated' }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore — see above.
  }
}
