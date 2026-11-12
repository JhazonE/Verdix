import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvText(text: string): ParsedFile {
  const clean = text.replace(/^﻿/, '');
  const parsed = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  const rows = (parsed.data ?? []).map((row) => {
    const out: Record<string, string> = {};
    for (const h of headers) out[h] = row[h] == null ? '' : String(row[h]);
    return out;
  });
  return { headers, rows };
}

/**
 * Reads a worksheet as rows of text, using each cell's STORED value.
 *
 * `sheet_to_json({ raw: false })` returns the text Excel would DISPLAY, which is
 * wrong for data import: a 13-digit barcode stored as a number displays as
 * "4.80002E+12", a price of 12.345 in a "0"-formatted cell displays as "12", and
 * "#,##0.00" injects thousands separators that Number() cannot parse. So numeric
 * cells use their stored value. Date cells are the exception — their stored value
 * is a serial number, so they keep the formatted text.
 */
function sheetToTextRows(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell: XLSX.CellObject | undefined = sheet[XLSX.utils.encode_cell({ r, c })];
      let text = '';
      if (cell && cell.v != null) {
        if (cell.t === 'n' && !(cell.z && XLSX.SSF.is_date(String(cell.z)))) text = String(cell.v);
        else text = cell.w ?? String(cell.v);
      }
      if (text !== '') hasValue = true;
      cells.push(text);
    }
    if (hasValue) rows.push(cells);
  }
  return rows;
}

export function parseXlsxBuffer(buf: ArrayBuffer): ParsedFile {
  // cellNF keeps each cell's number format (`z`); sheetToTextRows needs it to
  // tell date cells (formatted text) from plain numbers (stored value).
  const wb = XLSX.read(buf, { type: 'array', cellNF: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  const aoa = sheetToTextRows(sheet);
  if (aoa.length === 0) return { headers: [], rows: [] };
  const headers = (aoa[0] ?? []).map((h) => String(h ?? '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const cells = aoa[i] ?? [];
    const out: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((h, idx) => {
      const v = cells[idx];
      const s = v == null ? '' : String(v);
      if (s !== '') hasValue = true;
      out[h] = s;
    });
    if (hasValue) rows.push(out);
  }
  return { headers, rows };
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseXlsxBuffer(await file.arrayBuffer());
  }
  return parseCsvText(await file.text());
}
