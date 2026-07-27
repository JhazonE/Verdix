export type ResolvedCallout = { n: number; x: number; y: number };

/** Self-contained styles for the callout badges. No external resources. */
export function calloutOverlayCss(): string {
  return `
.manual-callout-layer{position:fixed;inset:0;z-index:2147483647;pointer-events:none;}
.manual-callout-badge{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;
  border-radius:50%;background:#e11d48;color:#fff;border:2px solid #fff;
  font:700 15px/24px Arial,sans-serif;text-align:center;
  box-shadow:0 1px 4px rgba(0,0,0,.45);}
`.trim();
}

export function calloutMarkup(resolved: ResolvedCallout[]): string {
  if (resolved.length === 0) return '';
  const badges = resolved
    .map((c) => `<div class="manual-callout-badge" style="left:${Math.round(c.x)}px;top:${Math.round(c.y)}px">${c.n}</div>`)
    .join('');
  return `<div class="manual-callout-layer">${badges}</div>`;
}
