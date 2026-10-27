/**
 * live-events.ts
 *
 * In-process fan-out hub for cross-terminal refresh notifications.
 *
 * The app's original live-refresh channel was a BroadcastChannel, which by
 * definition only ever reaches other tabs of the SAME browser. This store runs
 * several terminals against one shared database, with the back office also
 * reachable from a second PC over the LAN, so a product saved on one machine
 * was invisible on every other machine until someone reloaded. This hub is the
 * server-side half of the fix: a writer POSTs an event, and every terminal
 * holding an SSE connection is told to refetch.
 *
 * Deliberately in-memory and single-process. Each physical terminal runs its
 * own Next.js server against the shared DB, so subscribers here are the tabs
 * connected to THIS server; the publish endpoint is what carries an event
 * between machines. Nothing is persisted: a missed event costs a terminal one
 * polling interval of staleness, never correctness, because every consumer is
 * a refetch trigger rather than a state delta.
 */

export type LiveEventName = 'stock-updated';

type Subscriber = (event: LiveEventName) => void;

// Module state survives route-handler invocations within a server process but
// is re-created on each dev-mode hot reload, which is harmless — clients
// reconnect on their own.
const subscribers = new Set<Subscriber>();

/** Registers a listener. Returns the unsubscribe function. */
export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Notifies every live subscriber. A throwing subscriber (a stream that closed
 * between our check and the write) must not stop the others from being told.
 */
export function publish(event: LiveEventName): void {
  for (const fn of Array.from(subscribers)) {
    try {
      fn(event);
    } catch {
      subscribers.delete(fn);
    }
  }
}

/** Exposed for the health/debug surface. */
export function subscriberCount(): number {
  return subscribers.size;
}

// ---------------------------------------------------------------------------
// Cross-process bridge
//
// The hub above only reaches tabs connected to THIS server process. A browser
// on a second PC pointed at this machine's IP is such a tab and is already
// covered. Two Electron terminals are not: each runs its own server, so an
// event published on one is invisible to the other. The shared database is
// the only thing both demonstrably have in common, so writers bump a counter
// there and every server watches it.
// ---------------------------------------------------------------------------

const EVENT_NAME: LiveEventName = 'stock-updated';
const WATCH_INTERVAL_MS = 3000;

let lastSeenRevision: bigint | null = null;
let watcher: ReturnType<typeof setInterval> | null = null;

/** Bumps the shared counter so other server processes see the change. */
export async function publishToDatabase(): Promise<void> {
  const { query } = await import('./mysql');
  // The row is seeded by migration 145; the upsert keeps this working on a
  // database where that row was removed by hand rather than failing silently.
  await query(
    `INSERT INTO live_events (name, revision) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE revision = revision + 1`,
    [EVENT_NAME]
  );

  // Our own clients were already notified synchronously by publish(), so
  // adopt the new revision here to stop the watcher re-firing on a bump this
  // process made itself. Purely an efficiency measure: a missed adoption
  // (a concurrent bump landing between the write and this read) costs one
  // redundant refetch, which is why it is allowed to fail quietly.
  try {
    const revision = await readRevision();
    if (revision !== null) lastSeenRevision = revision;
  } catch {
    // Leave the baseline alone; the watcher will simply fire once more.
  }
}

async function readRevision(): Promise<bigint | null> {
  const { query } = await import('./mysql');
  const rows: any = await query(
    `SELECT revision FROM live_events WHERE name = ?`,
    [EVENT_NAME]
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return BigInt(rows[0].revision ?? 0);
}

/**
 * Starts watching the shared counter. Idempotent, and a no-op once there are
 * no subscribers left to notify — see stopWatchingDatabase.
 *
 * A poll rather than a push because MySQL gives us no notification channel.
 * The interval is the floor on cross-TERMINAL latency only; same-server tabs
 * are still notified synchronously through publish().
 */
export function startWatchingDatabase(): void {
  if (watcher) return;

  watcher = setInterval(async () => {
    try {
      const revision = await readRevision();
      if (revision === null) return;

      // The first read establishes a baseline. Firing on it would make every
      // server restart look like a change and stampede all its clients.
      if (lastSeenRevision === null) {
        lastSeenRevision = revision;
        return;
      }

      if (revision !== lastSeenRevision) {
        lastSeenRevision = revision;
        publish(EVENT_NAME);
      }
    } catch {
      // A database hiccup must not kill the watcher; the next tick retries.
      // Staleness during an outage is not a concern because nothing can be
      // written during one either.
    }
  }, WATCH_INTERVAL_MS);

  // Never hold the process open for this.
  watcher.unref?.();
}

/** Stops the watcher when the last subscriber disconnects. */
export function stopWatchingDatabase(): void {
  if (!watcher) return;
  clearInterval(watcher);
  watcher = null;
  // Drop the baseline too: on reconnect we want a fresh one rather than a
  // comparison against a revision from before an arbitrarily long idle gap.
  lastSeenRevision = null;
}
