import { NextRequest } from 'next/server';
import { parseXlsxBuffer, parseCsvText } from '@/lib/import/parse-file';
import { mapParsedRowsToPriceListRows } from '@/app/(app)/products/bulk-price-update/price-list-template';
import { checkApprovalRequired } from '@/lib/approvals';
import {
  loadMatchMaps, matchPriceListRows, applyMatchedItems, insertNewProducts,
} from '@/lib/price-list-import';

/** Rows echoed back as a preview sample. All skipped rows are returned uncapped. */
const SAMPLE_LIMIT = 50;

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ message: 'Could not read the uploaded form.' }, { status: 400 });
  }

  const file = form.get('file');
  const warehouseId = String(form.get('warehouseId') || '');
  const mode = String(form.get('mode') || 'preview');
  const confirmCreate = String(form.get('confirmCreate') || '') === '1';
  // Accepted for forward-compatibility with the brief's field list, but not yet
  // wired anywhere: insertNewProducts() takes no userId parameter, so Excel-created
  // products currently carry no creator attribution. Wiring that up (a signature
  // change plus whatever column/audit-log it should land in) is a separate change.
  const userId = String(form.get('userId') || '');

  if (!(file instanceof File)) return Response.json({ message: 'No file uploaded.' }, { status: 400 });
  if (!warehouseId) return Response.json({ message: 'No warehouse selected.' }, { status: 400 });
  if (mode !== 'preview' && mode !== 'apply') return Response.json({ message: 'Invalid mode.' }, { status: 400 });

  // Parse before the approval gate so the gate can tell whether the file
  // actually contains new products, and so an unreadable file fails as a plain
  // 400 rather than mid-stream.
  let rows;
  try {
    const name = file.name.toLowerCase();
    const parsed = name.endsWith('.xlsx') || name.endsWith('.xls')
      ? parseXlsxBuffer(await file.arrayBuffer())
      : parseCsvText(await file.text());
    rows = mapParsedRowsToPriceListRows(parsed);
  } catch (error: any) {
    return Response.json({ message: `Could not read the spreadsheet: ${error.message}` }, { status: 400 });
  }

  if (rows.length === 0) return Response.json({ message: 'The spreadsheet has no data rows.' }, { status: 400 });

  // A 15,000-item batch lands in approval_queue.transaction_data as one ~4MB
  // JSON blob and the kanban renders every item as a table row — unreviewable.
  // Block the bulk path rather than queue something nobody can approve.
  if (await checkApprovalRequired('PRICE_UPDATE')) {
    return Response.json({
      message: 'Bulk Excel upload is not available while price approvals are on. Turn off price approvals, or use the manual selection drawer.',
    }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        send({ phase: 'parsing', total: rows.length });

        const maps = await loadMatchMaps(warehouseId, rows);
        send({ phase: 'matching', done: rows.length, total: rows.length });
        const result = matchPriceListRows(rows, maps);

        if (result.toCreate.length > 0 && await checkApprovalRequired('PRODUCT_CREATE')) {
          send({
            phase: 'error',
            message: 'This file creates new products, which is not available while product approvals are on.',
          });
          return;
        }

        if (mode === 'preview') {
          send({
            phase: 'done',
            mode: 'preview',
            matched: result.matched.length,
            toCreate: result.toCreate.length,
            skipped: result.skipped.length,
            matchedSample: result.matched.slice(0, SAMPLE_LIMIT),
            toCreateSample: result.toCreate.slice(0, SAMPLE_LIMIT),
            skippedRows: result.skipped,
          });
          return;
        }

        // apply
        if (result.toCreate.length > 0 && !confirmCreate) {
          send({ phase: 'error', message: 'This file creates new products; confirmation is required.' });
          return;
        }

        const totalWork = result.matched.length + result.toCreate.length;
        let base = 0;
        const applyOut = await applyMatchedItems(result.matched, (done) => {
          send({ phase: 'applying', done, total: totalWork });
        });
        base = result.matched.length;
        const createOut = await insertNewProducts(warehouseId, result.toCreate, (done) => {
          send({ phase: 'applying', done: base + done, total: totalWork });
        });

        send({
          phase: 'done',
          mode: 'apply',
          applied: applyOut.applied,
          created: createOut.created,
          skipped: result.skipped.length + applyOut.skipped.length,
          failed: createOut.failed.length,
          skippedRows: result.skipped,
        });
      } catch (error: any) {
        send({ phase: 'error', message: error?.message || 'Processing failed.' });
      } finally {
        // Sole owner of closing the stream — every early-return path above falls
        // through to here instead of closing inline, so this can never double-close
        // (which throws "Invalid state: Controller is already closed" and would
        // otherwise make any cleanup added here silently unreachable on the common
        // preview/denial paths).
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
