// Large Invoice layout toggles default to ON. MySQL hands the columns back as
// 0/1, so a plain `!== false` check would treat 0 as "show"; and a row that
// predates the column (NULL/undefined) must keep printing what it always did.
export function largeInvoiceFlag(value: boolean | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return Boolean(Number(value));
}
