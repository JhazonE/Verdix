'use client';

/**
 * Price-checker kiosk — placeholder shell.
 *
 * Task 2 needs the route to resolve so the routing tests can assert the pin
 * and the absence of chrome. Task 4 replaces this with the real screen.
 */
export default function PriceCheckPage() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-slate-100">
      <p className="text-3xl font-bold">I-scan ang barcode</p>
      <p className="mt-2 text-sm opacity-60">Scan a barcode to see the price</p>
    </div>
  );
}
