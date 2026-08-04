import { NextResponse } from 'next/server';

// Identity probe for the Electron launcher. main.js polls this before creating
// the window so it can tell OUR server apart from any other process holding the
// port (a WAMP/Apache stack answering 200 was previously mistaken for the POS,
// so the real server never got spawned).
//
// Deliberately does NOT touch the database: this must answer as soon as the
// server binds, and a DB hiccup should not read as "server is down".
export async function GET() {
  return NextResponse.json({
    success: true,
    service: 'verdix-pos',
    timestamp: new Date().toISOString(),
  });
}
