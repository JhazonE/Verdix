import assert from 'node:assert/strict';
import { buildFiles } from '../../lib/ejournal/ejournal-build';
import type { EJournalData } from '../../lib/ejournal/types';

const settings = { businessName: 'S', paperSize: '58mm' };

const data: EJournalData = {
  settings,
  salesInvoices: [{
    siNumber: 1, birOrNumber: null, dateTime: '2026-07-21T10:00:00.000Z',
    items: [{ name: 'A', quantity: 1, price: 10 }], total: 10, vatAmount: 1,
  }],
  voided: [],
  merchandiseCredits: [],
  xReadings: [],
  zReadings: [],
};

const files = buildFiles(data);
assert.ok(files['sales-invoices'].includes('SI NO.: 000001'), 'sales file has the SI');
assert.ok(files['voided'].includes('No voided'), 'empty voided file has explicit note');
assert.ok(files['merchandise-credits'].includes('No merchandise credits'), 'empty credits note');
assert.ok(files['x-readings'].includes('No X-readings'), 'empty x note');
assert.ok(files['z-reading'].includes('No Z-reading'), 'empty z note');
