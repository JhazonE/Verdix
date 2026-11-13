/**
 * In-memory sliding-window rate limiting.
 *
 * Pure module — no Next.js or DB imports — so `proxy.ts`, route handlers and
 * unit tests can all use it.
 *
 * State lives in process memory. That matches how Verdix runs (one Next.js
 * server per deployment; Electron terminals each run their own). It is NOT
 * shared between server instances: if the hosted POS is ever scaled to more
 * than one replica, each replica enforces its own budget and the effective
 * limit becomes `limit × replicas`. Move to a shared store before doing that.
 *
 * Algorithm: sliding-window *counter*. Each key keeps the hit count of the
 * current fixed window plus the previous one; the usage is
 * `prev × (1 − elapsedFraction) + current`. This avoids the burst-at-the-
 * boundary hole of a plain fixed window for O(1) memory per key.
 */

export interface RateLimitResult {
    allowed: boolean;
    limit: number;
    /** Whole hits left before the limiter starts refusing. */
    remaining: number;
    /** Seconds until a refused caller can succeed. 0 when allowed. */
    retryAfterSec: number;
}

interface Bucket {
    start: number;
    count: number;
    prev: number;
}

export class SlidingWindowLimiter {
    private buckets = new Map<string, Bucket>();
    private lastSweep = 0;

    constructor(
        readonly limit: number,
        readonly windowMs: number,
        private readonly maxKeys = 50_000,
    ) {}

    private roll(key: string, now: number): Bucket {
        let b = this.buckets.get(key);
        if (!b) {
            b = { start: now, count: 0, prev: 0 };
            this.buckets.set(key, b);
            return b;
        }
        const elapsed = now - b.start;
        if (elapsed >= this.windowMs) {
            const windows = Math.floor(elapsed / this.windowMs);
            // Only the immediately preceding window still counts.
            b.prev = windows === 1 ? b.count : 0;
            b.count = 0;
            b.start += windows * this.windowMs;
        }
        return b;
    }

    private used(b: Bucket, now: number): number {
        const fraction = Math.min(1, Math.max(0, (now - b.start) / this.windowMs));
        return b.prev * (1 - fraction) + b.count;
    }

    private retryAfterMs(b: Bucket, now: number): number {
        // Still inside the current window: the previous window's weight decays.
        if (b.count < this.limit && b.prev > 0) {
            const f = 1 - (this.limit - b.count) / b.prev;
            if (f < 1) return Math.max(0, b.start + f * this.windowMs - now);
        }
        // Otherwise wait for the window to roll (then count becomes `prev`).
        const f = b.count > 0 ? Math.max(0, 1 - this.limit / b.count) : 0;
        return Math.max(0, b.start + this.windowMs + f * this.windowMs - now);
    }

    private result(b: Bucket, now: number, allowed: boolean): RateLimitResult {
        const used = this.used(b, now);
        return {
            allowed,
            limit: this.limit,
            remaining: Math.max(0, Math.floor(this.limit - used)),
            // +1 ms so rounding up to whole seconds always lands past the edge.
            retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((this.retryAfterMs(b, now) + 1) / 1000)),
        };
    }

    /** Would one more hit be allowed? Does not count a hit. */
    peek(key: string, now: number = Date.now()): RateLimitResult {
        const b = this.buckets.get(key);
        if (!b) return { allowed: true, limit: this.limit, remaining: this.limit, retryAfterSec: 0 };
        this.roll(key, now);
        return this.result(b, now, this.used(b, now) < this.limit);
    }

    /**
     * Count one hit if there is room. A refused call is NOT counted, so a
     * caller hammering a blocked key does not extend its own block.
     */
    consume(key: string, now: number = Date.now()): RateLimitResult {
        this.sweep(now);
        const b = this.roll(key, now);
        if (this.used(b, now) >= this.limit) return this.result(b, now, false);
        b.count += 1;
        return this.result(b, now, true);
    }

    /**
     * Count a hit unconditionally (used for failed logins, where the caller
     * has already decided whether to proceed via `peek`).
     */
    record(key: string, now: number = Date.now()): void {
        this.sweep(now);
        this.roll(key, now).count += 1;
    }

    reset(key: string): void {
        this.buckets.delete(key);
    }

    get size(): number {
        return this.buckets.size;
    }

    private sweep(now: number): void {
        if (now - this.lastSweep < this.windowMs && this.buckets.size < this.maxKeys) return;
        this.lastSweep = now;
        for (const [key, b] of this.buckets) {
            if (now - b.start >= 2 * this.windowMs) this.buckets.delete(key);
        }
        // Hard cap against a flood of distinct keys: drop oldest-inserted.
        if (this.buckets.size >= this.maxKeys) {
            const excess = this.buckets.size - Math.floor(this.maxKeys * 0.9);
            let i = 0;
            for (const key of this.buckets.keys()) {
                if (i++ >= excess) break;
                this.buckets.delete(key);
            }
        }
    }
}

// ───────────────────────── client identity ─────────────────────────

/**
 * Best-effort client IP for requests that arrived through a reverse proxy.
 *
 * Returns `null` when no proxy header is present — i.e. a direct connection
 * (Electron on localhost, a LAN browser hitting the terminal's own server,
 * Playwright). Callers treat `null` as a trusted local client.
 *
 * `x-real-ip` is preferred; otherwise the LAST `x-forwarded-for` entry, which
 * is the one appended by our nearest proxy (the leftmost is client-supplied
 * and trivially spoofed). This assumes a single trusted proxy, as on Railway.
 */
export function getClientIp(headers: { get(name: string): string | null }): string | null {
    const real = headers.get('x-real-ip')?.trim();
    if (real) return real;
    const xff = headers.get('x-forwarded-for');
    if (xff) {
        const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
    }
    return null;
}

/** Loopback and RFC1918 / unique-local addresses. */
export function isPrivateIp(ip: string): boolean {
    const v = ip.toLowerCase().replace(/^::ffff:/, '');
    if (v === '::1' || v === 'localhost') return true;
    if (/^fc|^fd/.test(v) && v.includes(':')) return true; // IPv6 unique-local
    const m = v.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

// ───────────────────────── configured limiters ─────────────────────────

function envInt(name: string, fallback: number): number {
    const n = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function rateLimitDisabled(): boolean {
    return process.env.RATE_LIMIT_DISABLED === '1' || process.env.RATE_LIMIT_DISABLED === 'true';
}

// Kept on globalThis so dev-mode module reloads don't silently reset counters.
const g = globalThis as unknown as {
    __verdixApiLimiter?: SlidingWindowLimiter;
    __verdixLoginLimiters?: { perAccount: SlidingWindowLimiter; perIp: SlidingWindowLimiter };
};

/**
 * Whole-API budget per client IP. The default is deliberately generous: every
 * terminal in a store shares one public IP when the POS is hosted, and a
 * single POS screen polls several endpoints. Tune with RATE_LIMIT_API_PER_MIN.
 */
export function getApiLimiter(): SlidingWindowLimiter {
    return (g.__verdixApiLimiter ??= new SlidingWindowLimiter(
        envInt('RATE_LIMIT_API_PER_MIN', 1200),
        60_000,
    ));
}

/**
 * Failed-login budgets. Only FAILURES are counted (a successful login clears
 * the per-account counter), so a shift-start rush of correct logins is free.
 *  - perAccount: one username from one IP — stops guessing a single password.
 *  - perIp: all usernames from one IP — stops password spraying.
 */
export function getLoginLimiters() {
    return (g.__verdixLoginLimiters ??= {
        perAccount: new SlidingWindowLimiter(
            envInt('RATE_LIMIT_LOGIN_FAILURES', 5),
            envInt('RATE_LIMIT_LOGIN_WINDOW_MIN', 15) * 60_000,
        ),
        perIp: new SlidingWindowLimiter(
            envInt('RATE_LIMIT_LOGIN_FAILURES_PER_IP', 30),
            envInt('RATE_LIMIT_LOGIN_WINDOW_MIN', 15) * 60_000,
        ),
    });
}
