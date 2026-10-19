/**
 * The kiosk's resolved lookup. Declared in `lib/kiosk-price.ts` beside the
 * function that returns it, so `lib/` never imports from `app/`; re-exported
 * here so the UI has one local place to import its types from.
 */
export type { KioskResult } from '@/lib/kiosk-price';
