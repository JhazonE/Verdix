import assert from 'node:assert/strict';
import { SlidingWindowLimiter, getClientIp, isPrivateIp } from '../../lib/rate-limit';

const H = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
const MIN = 60_000;

// ── allows up to the limit, then refuses ──
{
    const l = new SlidingWindowLimiter(3, MIN);
    const t = 1_000_000;
    assert.equal(l.consume('a', t).allowed, true, 'hit 1');
    assert.equal(l.consume('a', t).allowed, true, 'hit 2');
    const third = l.consume('a', t);
    assert.equal(third.allowed, true, 'hit 3');
    assert.equal(third.remaining, 0, 'nothing left after the limit is reached');
    const fourth = l.consume('a', t);
    assert.equal(fourth.allowed, false, 'hit 4 refused');
    assert.ok(fourth.retryAfterSec >= 1, 'refusal carries a Retry-After');
    assert.equal(l.consume('b', t).allowed, true, 'keys are independent');
}

// ── refused calls are not counted (hammering does not extend the block) ──
{
    const l = new SlidingWindowLimiter(2, MIN);
    const t = 5_000_000;
    l.consume('k', t);
    l.consume('k', t);
    for (let i = 0; i < 50; i++) l.consume('k', t + i);
    const r = l.consume('k', t + MIN + 1);
    assert.equal(r.allowed, true, 'recovers after one window despite 50 refused calls');
}

// ── Retry-After is honest: waiting that long really does succeed ──
{
    const l = new SlidingWindowLimiter(5, 15 * MIN);
    const t = 10_000_000;
    for (let i = 0; i < 5; i++) l.record('acct', t + i * 1000);
    const blocked = l.peek('acct', t + 10_000);
    assert.equal(blocked.allowed, false, '5 failures block the 6th');
    const later = t + 10_000 + blocked.retryAfterSec * 1000;
    assert.equal(l.peek('acct', later).allowed, true, 'allowed again once Retry-After has elapsed');
    assert.equal(l.peek('acct', later - 5_000).allowed, false, 'but not meaningfully earlier');
}

// ── sliding window: no double burst across a window boundary ──
{
    const l = new SlidingWindowLimiter(10, MIN);
    const t = 20_000_000;
    for (let i = 0; i < 10; i++) l.consume('x', t + 59_000); // end of window 1
    // 2s into window 2 a fixed window would allow 10 more; sliding must not.
    assert.equal(l.consume('x', t + 61_000).allowed, false, 'boundary burst is refused');
    assert.equal(l.consume('x', t + 2 * MIN + 1).allowed, true, 'a full idle window later it is open');
}

// ── reset clears a key (successful login) ──
{
    const l = new SlidingWindowLimiter(2, MIN);
    l.record('u', 1); l.record('u', 1);
    assert.equal(l.peek('u', 2).allowed, false);
    l.reset('u');
    assert.equal(l.peek('u', 2).allowed, true, 'reset reopens the key');
}

// ── peek never counts ──
{
    const l = new SlidingWindowLimiter(1, MIN);
    for (let i = 0; i < 10; i++) l.peek('p', 1);
    assert.equal(l.consume('p', 1).allowed, true, 'peeking used no budget');
}

// ── memory stays bounded under a flood of distinct keys ──
{
    const l = new SlidingWindowLimiter(5, MIN, 100);
    for (let i = 0; i < 1000; i++) l.consume(`ip-${i}`, 1_000);
    assert.ok(l.size <= 100, `key count capped (got ${l.size})`);
    // idle keys are swept once they are two windows old
    const l2 = new SlidingWindowLimiter(5, MIN);
    for (let i = 0; i < 20; i++) l2.consume(`old-${i}`, 0);
    l2.consume('fresh', 3 * MIN);
    assert.equal(l2.size, 1, 'stale keys swept');
}

// ── client IP: never trusts the spoofable leftmost x-forwarded-for entry ──
assert.equal(getClientIp(H({})), null, 'direct connection → null');
assert.equal(getClientIp(H({ 'x-real-ip': '203.0.113.9' })), '203.0.113.9', 'x-real-ip wins');
assert.equal(
    getClientIp(H({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' })),
    '203.0.113.9',
    'uses the proxy-appended (last) entry, not the client-supplied first',
);

// ── private ranges are recognised; public ones are not ──
for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.1.50', '172.16.0.1', '172.31.255.1', '::ffff:192.168.0.2', 'fd00::1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} is private`);
}
for (const ip of ['8.8.8.8', '203.0.113.9', '172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.1.1']) {
    assert.equal(isPrivateIp(ip), false, `${ip} is public`);
}

console.log('✓ rate-limit tests passed');
