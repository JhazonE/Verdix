import assert from 'node:assert/strict';
import { daysPastDue, isPastDue } from '../../lib/due-date';

// An invoice's due date is a calendar DATE. Comparing it to the current instant
// made an invoice due TODAY read "Over Due 1 days" minutes after it was issued
// (a same-day cash invoice on the Sales Invoices page).

const dueToday = new Date(2026, 10, 12); // local midnight, 12 Nov — how the API delivers it
const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m);

// Due today: never overdue at any hour of that day, including 23:59.
for (const now of [at(0, 1), at(6, 48), at(14, 18), at(23, 59)]) {
  assert.equal(isPastDue(dueToday, now), false, 'due today is not overdue');
  assert.equal(daysPastDue(dueToday, now), 0);
}

// Overdue only once the due day has passed, counted in whole calendar days.
assert.equal(daysPastDue(dueToday, new Date(2026, 10, 13, 0, 1)), 1);
assert.equal(daysPastDue(dueToday, new Date(2026, 10, 13, 23, 59)), 1);
assert.equal(daysPastDue(dueToday, new Date(2026, 10, 15, 9, 0)), 3);
assert.equal(isPastDue(dueToday, new Date(2026, 10, 13, 8, 0)), true);

// Future due date, and a missing/invalid one, are not overdue.
assert.equal(isPastDue(new Date(2026, 10, 20), at(12)), false);
assert.equal(isPastDue(null, at(12)), false);
assert.equal(isPastDue(undefined, at(12)), false);
assert.equal(isPastDue('not a date', at(12)), false);

// ISO strings (what the API sends) behave like Dates.
assert.equal(isPastDue(dueToday.toISOString(), at(14)), false);
assert.equal(isPastDue(dueToday.toISOString(), new Date(2026, 10, 14, 1)), true);

console.log('✓ due-date');
