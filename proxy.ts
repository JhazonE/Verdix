import { NextRequest, NextResponse } from 'next/server';
import { getApiLimiter, getClientIp, isPrivateIp, rateLimitDisabled } from '@/lib/rate-limit';

/**
 * Global API rate limit (Next.js 16 `proxy`, formerly `middleware`).
 *
 * Only requests that arrived through a reverse proxy (x-real-ip /
 * x-forwarded-for present) are limited. A request with neither header is a
 * direct connection — Electron on localhost, a LAN browser talking to the
 * terminal's own server — and is trusted. Private/loopback addresses are
 * exempt for the same reason. The login route has its own, stricter limiter
 * that applies to everyone (see app/api/auth/login/route.ts).
 */
export function proxy(request: NextRequest) {
    if (rateLimitDisabled() || request.method === 'OPTIONS') return NextResponse.next();

    const path = request.nextUrl.pathname;
    // Liveness probes (Electron boot check, Railway) must never be throttled.
    if (path === '/api/health') return NextResponse.next();

    const ip = getClientIp(request.headers);
    if (!ip || isPrivateIp(ip)) return NextResponse.next();

    const limiter = getApiLimiter();
    const result = limiter.consume(ip);

    if (!result.allowed) {
        return NextResponse.json(
            { error: 'Too many requests. Please slow down and try again shortly.' },
            {
                status: 429,
                headers: {
                    'Retry-After': String(result.retryAfterSec),
                    'X-RateLimit-Limit': String(result.limit),
                    'X-RateLimit-Remaining': '0',
                },
            },
        );
    }

    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(result.limit));
    response.headers.set('X-RateLimit-Remaining', String(result.remaining));
    return response;
}

export const config = {
    matcher: '/api/:path*',
};
