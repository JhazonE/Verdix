/**
 * Utility functions for fiscal year calculations
 */

/**
 * Formats a Date as a local YYYY-MM-DD string (no UTC conversion).
 * Use this instead of .toISOString().split('T')[0] when the date represents
 * a local calendar day — toISOString() shifts by the UTC offset and can move
 * the day (e.g. local Apr 1 00:00 in UTC+8 becomes "2024-03-31").
 */
export function toLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats a Date as a local `YYYY-MM-DD HH:MM:SS` string for a MySQL DATETIME
 * column (no UTC conversion).
 *
 * Use this instead of `.toISOString().slice(0, 19).replace('T', ' ')`, which
 * converts to UTC and then stores the result in a column that has no timezone
 * — so in UTC+8 a 4:15 PM transaction is written as 08:15 and reads back eight
 * hours early. MySQL's own NOW() and CURRENT_TIMESTAMP use the server's local
 * time, so a UTC string stored beside them is inconsistent as well as wrong.
 */
export function toLocalDateTime(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${toLocalYmd(date)} ${hh}:${mi}:${ss}`;
}

/**
 * Gets the fiscal year for a given date and start month.
 *
 * @param date The date to check
 * @param startMonth The month the fiscal year starts (1-12)
 * @returns The fiscal year number
 */
export function getFiscalYear(date: Date, startMonth: number): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // getMonth() is 0-indexed

  // If startMonth is 1 (January), fiscal year is same as calendar year
  if (startMonth === 1) return year;

  // If the current month is less than the start month, we are in the previous calendar year's fiscal year
  // Example: Fiscal year starts in April (4). If it's March (3) 2024, it's still FY 2023.
  if (month < startMonth) {
    return year - 1;
  }

  return year;
}

/**
 * Gets the fiscal year that the given date currently falls in.
 *
 * @param startMonth The month the fiscal year starts (1-12)
 * @param now The reference date (defaults to today)
 * @returns The current fiscal year number
 */
export function getCurrentFiscalYear(startMonth: number, now: Date = new Date()): number {
  return getFiscalYear(now, startMonth);
}

/**
 * Gets the fiscal period (1-12) for a given date and start month.
 * 
 * @param date The date to check
 * @param startMonth The month the fiscal year starts (1-12)
 * @returns The fiscal period (1-12)
 */
export function getFiscalPeriod(date: Date, startMonth: number): number {
  const month = date.getMonth() + 1; // 1-12

  if (month >= startMonth) {
    return month - startMonth + 1;
  } else {
    return month + (12 - startMonth) + 1;
  }
}

/**
 * Gets the start and end dates for a given fiscal year and start month.
 * 
 * @param fiscalYear The fiscal year (e.g., 2024)
 * @param startMonth The month the fiscal year starts (1-12)
 * @returns An object with startDate and endDate
 */
export function getFiscalYearRange(fiscalYear: number, startMonth: number): { startDate: Date; endDate: Date } {
  const startDate = new Date(fiscalYear, startMonth - 1, 1);
  const endDate = new Date(fiscalYear + 1, startMonth - 1, 0); // Last day of the previous calendar month
  
  // Set to start/end of day
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);
  
  return { startDate, endDate };
}

/**
 * Formats a fiscal year for display (e.g., "FY 2023-2024" or just "FY 2024")
 * 
 * @param fiscalYear The fiscal year number
 * @param startMonth The month the fiscal year starts (1-12)
 * @returns A formatted string
 */
export function formatFiscalYear(fiscalYear: number, startMonth: number): string {
  if (startMonth === 1) return `FY ${fiscalYear}`;
  return `FY ${fiscalYear}-${fiscalYear + 1}`;
}
