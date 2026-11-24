/**
 * color-themes.ts
 *
 * Store-wide brand colour, chosen with a colour picker in Developer Options.
 *
 * One hex colour drives the whole palette: it becomes the light-mode primary
 * as-is, and its hue tints every surface (page background, borders, muted
 * fills, sidebar). A lighter variant is derived for dark mode, and the text
 * colour on top of the primary is picked for contrast. The CSS that consumes
 * these variables lives in `app/globals.css` under `data-color-theme='custom'`.
 *
 * Light/dark mode (next-themes, the `.dark` class) is independent of this and
 * still chosen per machine in Settings → Appearance — the derived variables
 * cover both, so the two choices compose.
 *
 * No colour saved (NULL, 'default', or anything that is not #rrggbb) means the
 * original Ocean Blue palette, expressed by the ABSENCE of the attribute — so
 * a database that predates this feature, or a failed fetch, renders exactly
 * as before.
 *
 * Client-safe: no server imports.
 */

/** The original primary (221 83% 53%) — what the picker shows when unset. */
export const DEFAULT_BRAND_COLOR = '#2463eb';

/** localStorage key caching the derived variables so a reload paints in them. */
export const COLOR_THEME_STORAGE_KEY = 'color-theme';

/**
 * True while the picker shows an unsaved preview. ColorThemeSync must not
 * "correct" the page back to the saved colour meanwhile — the native colour
 * dialog blurs the window, and the refetch on refocus would otherwise wipe the
 * preview the moment the dialog closes.
 */
let previewActive = false;
export function setColorPreviewActive(active: boolean) {
  previewActive = active;
}
export function isColorPreviewActive() {
  return previewActive;
}

const HEX_RE = /^#[0-9a-f]{6}$/;

/** `#RGB`/`#RRGGBB` (any case) → `#rrggbb`; anything else → null (= default). */
export function normalizeBrandColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + v.slice(1).split('').map(c => c + c).join('');
  return HEX_RE.test(v) ? v : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 10) / 10;

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function rgbToHsl([r, g, b]: [number, number, number]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Text colour for a filled surface. White is preferred (it is what buttons
 * normally carry) and kept while it reaches 3:1 — the WCAG bar for bold UI
 * text; below that, near-black in the colour's own hue.
 */
function foregroundFor(rgb: [number, number, number], h: number, s: number) {
  const contrastWithWhite = 1.05 / (luminance(rgb) + 0.05);
  return contrastWithWhite >= 3 ? '0 0% 100%' : `${round(h)} ${round(Math.min(s, 50))}% 8%`;
}

/** Every CSS variable the picker may set on <html>; cleared before each apply. */
const THEME_VARS = [
  '--th', '--th-s', '--th-sd', '--th-sd2', '--th-sb', '--th-sb2', '--th-sp', '--th-spf',
  '--brand', '--brand-fg', '--brand-dark', '--brand-dark-fg',
] as const;

/** Derives the full palette (as HSL channel strings) from one hex colour. */
export function buildThemeVars(hex: string): Record<string, string> {
  const rgb = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(rgb);
  const H = round(h);
  const S = round(s);

  // Dark mode needs a lighter primary to read on near-black surfaces. A
  // near-black/grey pick (e.g. charcoal) flips to near-white instead, since
  // any mid-grey "lighter" version would just look disabled.
  const nearBlackGrey = s < 15 && l < 25;
  const darkL = nearBlackGrey ? 98 : l > 72 ? l : clamp(l + 12, 55, 72);
  const darkS = nearBlackGrey ? 0 : S;
  const darkRgb = hslToRgb(h, darkS, darkL);

  const vars: Record<string, string> = {
    '--th': String(H),
    // Surfaces never get more saturated than the pick itself, so a grey pick
    // gives grey surfaces rather than tinted ones.
    '--th-s': `${round(Math.min(30, s))}%`,
    '--th-sd': `${round(Math.min(40, s))}%`,
    '--th-sd2': `${round(Math.min(28, s))}%`,
    '--th-sb': `${round(Math.min(40, s))}%`,
    '--th-sb2': `${round(Math.min(30, s))}%`,
    '--brand': `${H} ${S}% ${round(l)}%`,
    '--brand-fg': foregroundFor(rgb, h, s),
    '--brand-dark': `${H} ${round(darkS)}% ${round(darkL)}%`,
    '--brand-dark-fg': foregroundFor(darkRgb, h, darkS),
  };

  // The sidebar is dark in BOTH modes. A dark pick would vanish on it, so the
  // sidebar's active item uses the dark-mode (lighter) variant instead.
  if (l < 35) {
    vars['--th-sp'] = vars['--brand-dark'];
    vars['--th-spf'] = vars['--brand-dark-fg'];
  }
  return vars;
}

function setVars(vars: Record<string, string> | null) {
  const root = document.documentElement;
  for (const name of THEME_VARS) root.style.removeProperty(name);
  if (!vars) {
    root.removeAttribute('data-color-theme');
    return;
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.setAttribute('data-color-theme', 'custom');
}

/**
 * Applies a brand colour (or null for the default palette) to the document and
 * caches the derived variables for the boot script. Safe on the server (no-op)
 * and with garbage input (treated as default). Returns the normalised colour.
 *
 * `cache: false` is for unsaved previews: a reload must never boot into a
 * colour that was only being tried out.
 */
export function applyColorTheme(value: unknown, { cache = true }: { cache?: boolean } = {}): string | null {
  const hex = normalizeBrandColor(value);
  if (typeof document === 'undefined') return hex;
  const vars = hex ? buildThemeVars(hex) : null;
  setVars(vars);
  if (!cache) return hex;
  try {
    if (vars) localStorage.setItem(COLOR_THEME_STORAGE_KEY, JSON.stringify(vars));
    else localStorage.removeItem(COLOR_THEME_STORAGE_KEY);
  } catch {
    // Storage blocked — the colour still applies for this page view.
  }
  return hex;
}

/**
 * Inline <head> script: paints the cached palette before React hydrates so a
 * reload never flashes the default blue first. It only copies the cached
 * variables (validated: `--name` keys, numeric/percent values) — the colour
 * maths stays in buildThemeVars. A non-JSON cache (an older format) throws and
 * is ignored.
 */
export const COLOR_THEME_BOOT_SCRIPT = `try{var v=JSON.parse(localStorage.getItem('${COLOR_THEME_STORAGE_KEY}')||'null');if(v&&typeof v==='object'){var r=document.documentElement;for(var k in v){if(/^--[a-z-]+$/.test(k)&&/^[0-9. %]+$/.test(String(v[k])))r.style.setProperty(k,v[k])}r.setAttribute('data-color-theme','custom')}}catch(e){}`;
