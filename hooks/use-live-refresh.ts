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

    // 3. Cross-machine listener (SSE)
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      try {
        source = new EventSource(getApiUrl('/live-events'));
        source.addEventListener('stock-updated', run);
        source.onerror = () => {
          // EventSource retries on its own for a dropped connection, but not
          // for one that errored before opening (server restarted, terminal
          // asleep). Closing and re-opening on a timer covers both without
          // stacking two retry loops.
          source?.close();
          source = null;
          if (disposed) return;
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        };
      } catch {
        // No EventSource (or a blocked URL) — polling remains the fallback.
      }
    };

    connect();

    return () => {
      disposed = true;
      window.removeEventListener('stock-updated', run);
      channel?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
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
