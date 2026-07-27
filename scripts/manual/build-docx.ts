/**
 * Verdix POS User Manual — Word document builder.
 *
 * Consumes the structured content in `content.ts` plus the screenshots in
 * `docs/manual/images/*.png` (see `screens.ts` for the slug → caption map)
 * and assembles a printable .docx.
 *
 * Design notes:
 * - Figure numbering (`Figure N: ...`) increments across the WHOLE document,
 *   not per chapter, because the manual is meant to be printed as one book.
 * - A missing screenshot must never abort the build — retail staff need a
 *   usable manual even from a partial capture run. Missing slugs degrade to
 *   a shaded placeholder paragraph and are collected into `missing[]` so the
 *   caller (and the console log, when run directly) can see what to recapture.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHAPTERS, MANUAL_SUBTITLE, MANUAL_TITLE, type Block } from './content';
import { SCREENS } from './screens';

const IMAGES_DIR = path.join(__dirname, '..', '..', 'docs', 'manual', 'images');
const DEFAULT_OUT = path.join(__dirname, '..', '..', 'docs', 'manual', 'VerdixPOS-User-Manual.docx');

// Source screenshots are captured at 1440x900; scaling to 600px wide keeps
// the exact 1.6 aspect ratio (600 / 1.6 = 375).
const FIGURE_WIDTH_PX = 600;
const FIGURE_HEIGHT_PX = 375;

const NUMBERING_REFERENCE = 'manual-steps';

const SCREEN_TITLE_BY_SLUG = new Map(SCREENS.map((s) => [s.slug, s.title]));

function shadedParagraph(text: string, fill: string, opts: { italics?: boolean } = {}): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
    children: [new TextRun({ text, italics: opts.italics })],
    spacing: { before: 120, after: 120 },
  });
}

function noteTable(variant: 'tip' | 'warning', text: string): Table {
  const fill = variant === 'tip' ? 'FFF3C4' : 'F8D0D0';
  const prefix = variant === 'tip' ? 'Tip: ' : 'Warning: ';
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: prefix, bold: true }),
                  new TextRun({ text }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function dataTable(headers: string[], rows: string[][]): Table {
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
    left: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
    right: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: '888888' },
  };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'DDDDDD' },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        }),
    ),
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              margins: { top: 80, bottom: 80, left: 100, right: 100 },
              children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
            }),
        ),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [headerRow, ...bodyRows],
  });
}

/** Mutable state threaded through block rendering: figure counter + missing slugs. */
type BuildState = { figureN: number; missing: string[] };

function renderBlock(block: Block, state: BuildState): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'para':
      return [new Paragraph({ text: block.text, spacing: { after: 160 } })];

    case 'steps':
      return block.items.map(
        (item) =>
          new Paragraph({
            text: item,
            numbering: { reference: NUMBERING_REFERENCE, level: 0 },
            spacing: { after: 80 },
          }),
      );

    case 'note':
      return [noteTable(block.variant, block.text), new Paragraph({ text: '' })];

    case 'table':
      return [dataTable(block.headers, block.rows), new Paragraph({ text: '' })];

    case 'figure': {
      const pngPath = path.join(IMAGES_DIR, `${block.slug}.png`);
      const title = SCREEN_TITLE_BY_SLUG.get(block.slug) ?? block.slug;

      if (!existsSync(pngPath)) {
        state.missing.push(block.slug);
        return [shadedParagraph(`[SCREENSHOT MISSING: ${block.slug}]`, 'F8D0D0')];
      }

      state.figureN += 1;
      const data = readFileSync(pngPath);
      const image = new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 40 },
        children: [
          new ImageRun({
            type: 'png',
            data,
            transformation: { width: FIGURE_WIDTH_PX, height: FIGURE_HEIGHT_PX },
          }),
        ],
      });
      const caption = new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new TextRun({ text: `Figure ${state.figureN}: ${title}`, italics: true }),
        ],
      });
      return [image, caption];
    }

    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return [];
    }
  }
}

export async function buildManual(outPath: string): Promise<{ figures: number; missing: string[] }> {
  const state: BuildState = { figureN: 0, missing: [] };

  const coverChildren: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 240 },
      children: [new TextRun({ text: MANUAL_TITLE, bold: true, size: 56 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [new TextRun({ text: MANUAL_SUBTITLE, size: 28 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Generated ${new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}`,
          size: 22,
          italics: true,
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const tocChildren: (Paragraph | TableOfContents)[] = [
    new Paragraph({
      children: [new TextRun({ text: 'Table of Contents', bold: true, size: 32 })],
      spacing: { after: 240 },
    }),
    new TableOfContents('Table of Contents', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const chapterChildren: (Paragraph | Table)[] = [];
  for (const chapter of CHAPTERS) {
    chapterChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        text: `Chapter ${chapter.number}: ${chapter.title}`,
      }),
    );
    chapterChildren.push(new Paragraph({ text: chapter.intro, spacing: { after: 200 } }));

    for (const section of chapter.sections) {
      chapterChildren.push(
        new Paragraph({ heading: HeadingLevel.HEADING_2, text: section.heading, spacing: { before: 200 } }),
      );
      for (const block of section.blocks) {
        chapterChildren.push(...renderBlock(block, state));
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: NUMBERING_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        children: [...coverChildren, ...tocChildren, ...chapterChildren],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, buffer);

  return { figures: state.figureN, missing: state.missing };
}

if (require.main === module) {
  buildManual(DEFAULT_OUT)
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
