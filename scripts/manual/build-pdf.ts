/**
 * Vendix POS User Manual — PDF builder.
 *
 * Consumes the SAME structured content as `build-docx.ts` (`content.ts` plus
 * the screenshots in `docs/manual/images/*.png`) and renders a print-ready
 * PDF. Both builders read one source of truth, so the Word and PDF editions
 * can never drift apart in wording.
 *
 * Why Chromium rather than a PDF drawing library (jsPDF is already a
 * dependency): the manual needs flowing prose, styled note callouts, data
 * tables, and figures that must not be split across a page boundary. Laying
 * that out by hand in jsPDF means reimplementing text wrapping and pagination;
 * Playwright is already a devDependency, and `page.pdf()` gives real CSS
 * pagination (`break-inside: avoid`) for free.
 *
 * Design notes mirrored from the DOCX builder:
 * - Figure numbering increments across the WHOLE document, not per chapter.
 * - A missing screenshot must never abort the build — it degrades to a shaded
 *   placeholder and is collected into `missing[]` for the caller to report.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { CHAPTERS, MANUAL_SUBTITLE, MANUAL_TITLE, type Block } from './content';
import { SCREENS } from './screens';

const IMAGES_DIR = path.join(__dirname, '..', '..', 'docs', 'manual', 'images');
const DEFAULT_OUT = path.join(__dirname, '..', '..', 'docs', 'manual', 'VendixPOS-User-Manual.pdf');

const SCREEN_TITLE_BY_SLUG = new Map(SCREENS.map((s) => [s.slug, s.title]));

/** Escape text taken from content.ts before it is interpolated into HTML. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type BuildState = { figureN: number; missing: string[] };

function renderBlock(block: Block, state: BuildState): string {
  switch (block.kind) {
    case 'para':
      return `<p>${esc(block.text)}</p>`;

    case 'steps':
      return `<ol>${block.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>`;

    case 'note': {
      const label = block.variant === 'tip' ? 'Tip' : 'Warning';
      // content.ts sometimes already opens the sentence with "Tip:"/"Warning:";
      // strip it so the rendered callout does not read "Tip: Tip: ...".
      const body = block.text.replace(/^\s*(tip|warning)\s*:\s*/i, '');
      return `<div class="note note-${block.variant}"><span class="note-label">${label}:</span> ${esc(body)}</div>`;
    }

    case 'table': {
      const head = block.headers.map((h) => `<th>${esc(h)}</th>`).join('');
      const body = block.rows
        .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    case 'figure': {
      const pngPath = path.join(IMAGES_DIR, `${block.slug}.png`);
      const title = SCREEN_TITLE_BY_SLUG.get(block.slug) ?? block.slug;

      if (!existsSync(pngPath)) {
        state.missing.push(block.slug);
        return `<div class="missing">[SCREENSHOT MISSING: ${esc(block.slug)}]</div>`;
      }

      state.figureN += 1;
      // Inline the PNG as a data URI: page.pdf() is driven from a
      // setContent() document with no base URL, so relative <img src> paths
      // would silently resolve to nothing and print blank figures.
      const dataUri = `data:image/png;base64,${readFileSync(pngPath).toString('base64')}`;
      return (
        `<figure>` +
        `<img src="${dataUri}" alt="${esc(title)}" />` +
        `<figcaption>Figure ${state.figureN}: ${esc(title)}</figcaption>` +
        `</figure>`
      );
    }

    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return '';
    }
  }
}

const STYLES = `
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  @page :first { margin: 0; }

  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Calibri, Arial, sans-serif;
    font-size: 11pt; line-height: 1.55; color: #1a1a1a; margin: 0;
  }

  /* ── Cover ─────────────────────────────────────────────────────── */
  .cover {
    height: 297mm; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    page-break-after: always; padding: 0 24mm;
  }
  .cover h1 { font-size: 34pt; font-weight: 800; margin: 0 0 10mm; letter-spacing: -0.4pt; }
  .cover .subtitle { font-size: 14pt; color: #444; margin: 0 0 18mm; }
  .cover .generated { font-size: 10pt; font-style: italic; color: #666; }
  .cover .rule { width: 40mm; height: 3px; background: #1e3a8a; margin: 0 0 10mm; }

  /* ── Table of contents ─────────────────────────────────────────── */
  .toc { page-break-after: always; }
  .toc h2 { font-size: 18pt; margin: 0 0 6mm; }
  .toc ol { list-style: none; padding: 0; margin: 0; }
  .toc > ol > li { margin: 0 0 2.5mm; font-weight: 600; }
  .toc .sec { list-style: none; padding: 0 0 0 8mm; margin: 1.5mm 0 0; font-weight: 400; }
  .toc .sec li { margin: 0 0 1mm; color: #333; font-size: 10pt; }
  .toc a { color: inherit; text-decoration: none; }

  /* ── Chapters ──────────────────────────────────────────────────── */
  h1.chapter {
    font-size: 20pt; font-weight: 700; color: #1e3a8a;
    margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid #1e3a8a;
    page-break-before: always; page-break-after: avoid;
  }
  h2.section {
    font-size: 13.5pt; font-weight: 700; margin: 7mm 0 2.5mm;
    page-break-after: avoid;
  }
  .intro { font-size: 11pt; color: #333; margin: 0 0 4mm; }
  p { margin: 0 0 3mm; orphans: 3; widows: 3; }
  ol { margin: 0 0 4mm; padding-left: 7mm; }
  li { margin: 0 0 1.5mm; }

  /* ── Note callouts ─────────────────────────────────────────────── */
  .note {
    border: 1px solid #b0b0b0; border-left-width: 4px;
    padding: 2.5mm 3mm; margin: 0 0 4mm; page-break-inside: avoid;
  }
  .note-tip { background: #fff8e1; border-left-color: #d9a300; }
  .note-warning { background: #fdecea; border-left-color: #c62828; }
  .note-label { font-weight: 700; }

  /* ── Tables ────────────────────────────────────────────────────── */
  table {
    width: 100%; border-collapse: collapse; margin: 0 0 4mm;
    font-size: 10pt; page-break-inside: avoid;
  }
  th, td { border: 1px solid #888; padding: 1.8mm 2.2mm; text-align: left; vertical-align: top; }
  th { background: #e8e8e8; font-weight: 700; }

  /* ── Figures ───────────────────────────────────────────────────── */
  figure { margin: 0 0 5mm; text-align: center; page-break-inside: avoid; }
  figure img { width: 100%; max-width: 160mm; border: 1px solid #ccc; }
  figcaption { font-size: 9.5pt; font-style: italic; color: #555; margin-top: 1.5mm; }
  .missing {
    background: #fdecea; border: 1px solid #c62828; color: #c62828;
    padding: 3mm; margin: 0 0 4mm; font-style: italic; text-align: center;
  }
`;

/**
 * Exported for tests and for previewing the layout in a browser without
 * generating a PDF (`renderManualHtml({ figureN: 0, missing: [] })`).
 */
export function buildHtml(state: BuildState): string {
  const generated = new Date().toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const toc = CHAPTERS.map(
    (c) =>
      `<li>Chapter ${c.number}: ${esc(c.title)}` +
      `<ol class="sec">${c.sections.map((s) => `<li>${esc(s.heading)}</li>`).join('')}</ol>` +
      `</li>`,
  ).join('');

  const chapters = CHAPTERS.map((chapter) => {
    const sections = chapter.sections
      .map(
        (section) =>
          `<h2 class="section">${esc(section.heading)}</h2>` +
          section.blocks.map((b) => renderBlock(b, state)).join(''),
      )
      .join('');

    return (
      `<h1 class="chapter">Chapter ${chapter.number}: ${esc(chapter.title)}</h1>` +
      `<p class="intro">${esc(chapter.intro)}</p>` +
      sections
    );
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(MANUAL_TITLE)}</title>
<style>${STYLES}</style></head>
<body>
  <div class="cover">
    <div class="rule"></div>
    <h1>${esc(MANUAL_TITLE)}</h1>
    <p class="subtitle">${esc(MANUAL_SUBTITLE)}</p>
    <p class="generated">Generated ${esc(generated)}</p>
  </div>
  <div class="toc">
    <h2>Table of Contents</h2>
    <ol>${toc}</ol>
  </div>
  ${chapters}
</body></html>`;
}

export async function buildManualPdf(outPath: string): Promise<{ figures: number; missing: string[] }> {
  const state: BuildState = { figureN: 0, missing: [] };
  const html = buildHtml(state);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // 'load' (not the default) so every inlined data-URI figure has decoded
    // before pagination is measured — otherwise images can occupy zero height
    // and the page breaks land in the wrong places.
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });

    mkdirSync(path.dirname(outPath), { recursive: true });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8pt;color:#777;padding:0 16mm;' +
        'display:flex;justify-content:space-between;">' +
        `<span>${MANUAL_TITLE.replace(/—/g, '-')}</span>` +
        '<span class="pageNumber"></span></div>',
      margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
    });
    writeFileSync(outPath, pdf);
  } finally {
    await browser.close();
  }

  return { figures: state.figureN, missing: state.missing };
}

if (require.main === module) {
  buildManualPdf(DEFAULT_OUT)
    .then(({ figures, missing }) => {
      console.log(`manual: wrote ${DEFAULT_OUT}`);
      console.log(`manual: embedded ${figures} figures`);
      if (missing.length > 0) {
        console.log(`manual: MISSING screenshots (${missing.length}): ${missing.join(', ')}`);
      } else {
        console.log('manual: no missing screenshots');
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
