/**
 * color-themes.ts
 *
 * The store-wide colour themes selectable from Developer Options.
 *
 * A theme is applied by setting `data-color-theme="<id>"` on <html>; the
 * matching CSS-variable overrides live in `app/globals.css`. Light/dark mode
 * (next-themes, the `.dark` class) is independent of this and still chosen per
 * machine in Settings → Appearance — a colour theme supplies BOTH a light and a
 * dark palette, so the two choices compose.
 *
 * `blue` is the original palette and is expressed by the ABSENCE of the
 * attribute, so a database that predates this feature (or a failed fetch)
 * renders exactly as before.
 *
 * Client-safe: no server imports. The `preview` strings are HSL channel triples
 * (the same format the CSS variables use) and only drive the picker swatches.
 */

export type ColorThemeId =
  | 'blue'
  | 'emerald'
  | 'teal'
  | 'violet'
  | 'rose'
  | 'orange'
  | 'graphite';

export interface ColorThemeDef {
  id: ColorThemeId;
  label: string;
  description: string;
  preview: {
    primary: string;
    sidebar: string;
    background: string;
  };
}

export const DEFAULT_COLOR_THEME: ColorThemeId = 'blue';

export const COLOR_THEMES: ColorThemeDef[] = [
  {
    id: 'blue',
    label: 'Ocean Blue',
    description: 'The original Vendix palette',
    preview: { primary: '221 83% 53%', sidebar: '222 47% 11%', background: '210 35% 94%' },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    description: 'Fresh green — groceries, produce',
    preview: { primary: '161 94% 30%', sidebar: '160 40% 11%', background: '160 30% 94%' },
  },
  {
    id: 'teal',
    label: 'Teal',
    description: 'Calm blue-green — pharmacy, clinic',
    preview: { primary: '175 84% 32%', sidebar: '178 40% 11%', background: '178 30% 94%' },
  },
  {
    id: 'violet',
    label: 'Violet',
    description: 'Rich purple — boutique, beauty',
    preview: { primary: '262 83% 58%', sidebar: '262 40% 11%', background: '262 30% 94%' },
  },
  {
    id: 'rose',
    label: 'Rose',
    description: 'Warm red-pink — fashion, gifts',
    preview: { primary: '347 77% 50%', sidebar: '345 40% 11%', background: '345 30% 94%' },
  },
  {
    id: 'orange',
    label: 'Sunset Orange',
    description: 'Energetic orange — food, hardware',
    preview: { primary: '21 90% 48%', sidebar: '24 40% 11%', background: '24 30% 94%' },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Neutral greys — minimal, high contrast',
    preview: { primary: '240 6% 10%', sidebar: '240 6% 11%', background: '240 5% 94%' },
  },
];

const IDS = new Set<string>(COLOR_THEMES.map(t => t.id));

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === 'string' && IDS.has(value);
}

/** Anything unknown (a removed theme, NULL, a typo) renders as the default. */
export function normalizeColorTheme(value: unknown): ColorThemeId {
  return isColorThemeId(value) ? value : DEFAULT_COLOR_THEME;
}

/** localStorage key caching the last known theme so a reload paints in it. */
export const COLOR_THEME_STORAGE_KEY = 'color-theme';

/** Same-tab event fired after the picker saves, so the change shows at once. */
export const COLOR_THEME_EVENT = 'color-theme-changed';

/**
 * Applies a theme to the document and caches it. Safe to call on the server
 * (no-op) and with garbage input (falls back to the default).
 */
export function applyColorTheme(value: unknown): ColorThemeId {
  const id = normalizeColorTheme(value);
  if (typeof document === 'undefined') return id;
  const root = document.documentElement;
  if (id === DEFAULT_COLOR_THEME) root.removeAttribute('data-color-theme');
  else root.setAttribute('data-color-theme', id);
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, id);
  } catch {
    // Storage blocked — the theme still applies for this page view.
  }
  return id;
}

/**
 * Inline <head> script: paints the cached theme before React hydrates so a
 * reload never flashes the default blue first. Kept as a string because it
 * runs before any bundle loads.
 */
export const COLOR_THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${COLOR_THEME_STORAGE_KEY}');if(t&&t!=='${DEFAULT_COLOR_THEME}'&&/^[a-z]+$/.test(t))document.documentElement.setAttribute('data-color-theme',t)}catch(e){}`;
