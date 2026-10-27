import { NextRequest } from 'next/server';
import {
  subscribe,
  publish,
  publishToDatabase,
  startWatchingDatabase,
  stopWatchingDatabase,
  subscriberCount,
  type LiveEventName,
} from '@/lib/live-events';

// A long-lived stream must not be buffered, cached or pre-rendered.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25 * 1000;

/**
 * GET /api/live-events — Server-Sent Events stream.
 *
 * Every back-office tab holds one of these open. When any terminal POSTs an
 * event, each connected client is told to refetch. This is what the old
 * BroadcastChannel could not do: reach a different machine.
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // The client vanished between the abort signal and this write.
          closed = true;
        }
      };

      // An initial comment flushes headers so the browser resolves the
      // connection immediately rather than sitting in "pending".
      send(': connected\n\n');

      const unsubscribe = subscribe((event: LiveEventName) => {
        send(`event: ${event}\ndata: {}\n\n`);
      });

      // Only poll the shared counter while someone is actually listening, so
      // an idle terminal with no back-office tab open costs the database
      // nothing.
      startWatchingDatabase();

      // Idle SSE connections are dropped by proxies and by some Windows
      // network stacks. A periodic comment keeps the socket warm without
      // waking any client-side handler.
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        if (subscriberCount() === 0) stopWatchingDatabase();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Next.js sits behind no proxy here, but Electron's packaged server and
      // any future reverse proxy both honour this.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * POST /api/live-events — publish an event to every connected client.
 *
 * Called by dispatchStockUpdate() after a write. Fire-and-forget: a failure
 * to notify must never surface as a failed save, since the data is already
 * committed and polling will catch the stragglers.
 */
export async function POST(request: NextRequest) {
  let event: LiveEventName = 'stock-updated';
  try {
    const body = await request.json();
    if (body?.event === 'stock-updated') event = body.event;
  } catch {
    // An empty or malformed body means the default event.
  }

  // Tabs on this server hear it immediately...
  publish(event);

  // ...and other terminals' servers pick it up from the shared counter. A
  // failure here is logged rather than returned: the caller's write has
  // already committed, and reporting a 500 would make a successful save look
  // broken. Polling remains the backstop.
  try {
    await publishToDatabase();
  } catch (error) {
    console.error('[live-events] Failed to publish to database:', error);
  }

  return Response.json({ success: true });
}
