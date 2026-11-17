// Paper size is chosen PER TERMINAL in the POS Connection Settings dialog and
// saved to localStorage ('pos_paper_size'); pos_settings.paper_size in the DB
// is only the store-wide default. The sale receipt already applies that
// override (use-pos.ts). Every other printout must resolve it the same way,
// or a till set to 80mm keeps printing readings at the DB's 58mm.
export type PaperSize = '58mm' | '80mm';

export function resolvePaperSize(dbPaperSize?: string | null): PaperSize {
  let local: string | null = null;
  try {
    local = typeof window !== 'undefined' ? localStorage.getItem('pos_paper_size') : null;
  } catch { /* storage blocked — fall back to the DB value */ }
  const value = local || dbPaperSize;
  return value === '80mm' ? '80mm' : '58mm';
}

/** Returns the settings object with paperSize replaced by the terminal's effective value. */
export function withTerminalPaperSize<T extends Record<string, any>>(settings: T): T & { paperSize: PaperSize } {
  return { ...settings, paperSize: resolvePaperSize(settings?.paperSize) };
}
