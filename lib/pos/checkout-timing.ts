/**
 * Opt-in phase timing for POS checkout.
 *
 * Checkout runs every query serially on one pooled connection inside a single
 * transaction, so its wall time is roughly (number of round trips × network
 * latency). On a LAN that is invisible; against a cloud MySQL it is the whole
 * cost of the request. This records where the time actually goes so an
 * optimisation can be aimed at measured round trips rather than guessed ones.
 *
 * Disabled unless POS_CHECKOUT_TIMING=true, so a normal sale pays nothing but
 * a few Date.now() calls. Enable it on the terminal that feels slow, tender a
 * sale, then read the [CheckoutTiming] line from the server log.
 */

const ENABLED = process.env.POS_CHECKOUT_TIMING === 'true';

export interface CheckoutTimer {
  /** Close the named phase that is currently open and start a new one. */
  phase(name: string): void;
  /** Count a round trip against a repeated phase (e.g. one per cart item). */
  count(name: string, n?: number): void;
  /** Close the final phase and emit one summary line to the server log. */
  done(meta?: Record<string, unknown>): void;
}

const NOOP: CheckoutTimer = {
  phase: () => {},
  count: () => {},
  done: () => {},
};

export function startCheckoutTimer(): CheckoutTimer {
  if (!ENABLED) return NOOP;

  const t0 = Date.now();
  const phases: { name: string; ms: number }[] = [];
  const counters = new Map<string, number>();
  let current: string | null = null;
  let currentStart = t0;

  const close = () => {
    if (current !== null) {
      phases.push({ name: current, ms: Date.now() - currentStart });
    }
  };

  return {
    phase(name: string) {
      close();
      current = name;
      currentStart = Date.now();
    },

    count(name: string, n = 1) {
      counters.set(name, (counters.get(name) || 0) + n);
    },

    done(meta: Record<string, unknown> = {}) {
      close();
      const total = Date.now() - t0;

      // Slowest first — the phase worth optimising is the one at the top.
      // Guard the percentage: a whole checkout can round to 0ms against a
      // local database, and "NaN%" in the one line meant to diagnose latency
      // would be actively misleading.
      const ranked = [...phases].sort((a, b) => b.ms - a.ms);
      const pct = (ms: number) => (total > 0 ? `${((ms / total) * 100).toFixed(0)}%` : 'n/a');
      const breakdown = ranked.map((p) => `${p.name}=${p.ms}ms (${pct(p.ms)})`).join('  ');
      const counted = [...counters.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join('  ');
      const metaStr = Object.entries(meta)
        .map(([k, v]) => `${k}=${v}`)
        .join('  ');

      console.log(
        `[CheckoutTiming] total=${total}ms  ${metaStr}\n` +
          `[CheckoutTiming]   phases: ${breakdown}` +
          (counted ? `\n[CheckoutTiming]   roundTrips: ${counted}` : '')
      );
    },
  };
}
