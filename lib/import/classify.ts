import type { EntitySchema } from './entity-schemas';
import { coerceValue } from './coerce';

export interface ClassifiedRow {
  sourceIndex: number;
  status: 'new' | 'update' | 'error';
  values: Record<string, string | number | boolean>;
  reason?: string;
  raw: Record<string, string>;
}

const keyPart = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function matchKeyOf(
  schema: EntitySchema,
  values: Record<string, string | number | boolean>,
): string | null {
  // Products: barcode wins when present, else name.
  if (schema.key === 'products') {
    const barcode = keyPart(values.barcode);
    if (barcode) return barcode;
    const name = keyPart(values.name);
    return name || null;
  }
  const parts = schema.matchKeys.map((k) => keyPart(values[k]));
  // Require the first match component (always a required field) to be present.
  if (!parts[0]) return null;
  return parts.join('');
}

export function classifyRows(
  rawRows: Record<string, string>[],
  mapping: Record<string, string | null>,
  schema: EntitySchema,
  existingKeys: Set<string>,
): ClassifiedRow[] {
  const seen = new Set<string>();
  const out: ClassifiedRow[] = [];

  rawRows.forEach((raw, sourceIndex) => {
    const values: Record<string, string | number | boolean> = {};
    let error: string | null = null;

    for (const field of schema.fields) {
      const header = mapping[field.key];
      const rawVal = header ? raw[header] : undefined;
      const isEmpty = rawVal === undefined || String(rawVal).trim() === '';

      if (isEmpty) {
        if (field.required) { error = error ?? `Missing required "${field.label}"`; continue; }
        // A field whose column was never mapped at all is OMITTED, not
        // defaulted. The default exists for a blank CELL in a column the user
        // did map ("this row has no reorder point"), not for a column they
        // never supplied. Defaulting an unmapped column let a sheet with no
        // price column at all overwrite every product's shelf price with 0 —
        // the import route reads an absent key as "leave this alone", which is
        // the only safe reading when the user never mentioned the field.
        if (!header) continue;
        if (field.default !== undefined) { values[field.key] = field.default; continue; }
        // leave unset -> route applies its own null default
        continue;
      }

      const coerced = coerceValue(field.type, rawVal);
      if (!coerced.ok) { error = error ?? `${field.label}: ${coerced.reason}`; continue; }
      values[field.key] = coerced.value;
    }

    if (error) {
      out.push({ sourceIndex, status: 'error', values, reason: error, raw });
      return;
    }

    const key = matchKeyOf(schema, values);
    if (key === null) {
      out.push({ sourceIndex, status: 'error', values, reason: 'Missing identifier', raw });
      return;
    }
    if (seen.has(key)) {
      out.push({ sourceIndex, status: 'error', values, reason: `Duplicate of another row (${key})`, raw });
      return;
    }
    seen.add(key);

    out.push({
      sourceIndex,
      status: existingKeys.has(key) ? 'update' : 'new',
      values,
      raw,
    });
  });

  return out;
}
