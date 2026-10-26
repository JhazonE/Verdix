import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The warehouse scope control replaced the hidden warehouse filter. Its rules
 * are small but each one was a real decision, so they are pinned here against
 * the source rather than left to a render test this project has no runner for.
 */

const SRC = readFileSync(
  path.join(__dirname, '..', '..', 'components', 'warehouse-scope.tsx'),
  'utf8',
);

// A count of 0 is a REAL count — a warehouse with nothing in it must still show
// "0" rather than fall back to no badge. A truthiness check would hide it,
// which is exactly the "is a thin table broken?" confusion the control exists
// to prevent.
assert.match(
  SRC,
  /option\.count !== undefined/,
  'counts are tested against undefined, not truthiness, so 0 still renders',
);
assert.doesNotMatch(
  SRC,
  /\{option\.count &&/,
  'a truthy check on count would hide a legitimate 0',
);

// With one warehouse there is no scope to pick: STORE and "All warehouses"
// would list identical rows, so the control hides itself entirely.
assert.match(
  SRC,
  /visible\.length < 2/,
  'the control hides itself when there is nothing to choose between',
);

// The main warehouse leads the list. Sorting by name alone put BODEGA ahead of
// STORE, so the scope people are nearly always in sat second and the control
// read as an alphabetical list instead of "here, then elsewhere".
assert.match(
  SRC,
  /Number\(!!b\.isMain\) - Number\(!!a\.isMain\)/,
  'the main warehouse is promoted to the front',
);

// Retired warehouses are dropped, but never the one currently scoped to —
// otherwise the control could not display its own value and the user would be
// stuck in a scope with no visible way out.
assert.match(
  SRC,
  /w\.isActive !== false \|\| w\.id === value/,
  'an inactive warehouse is kept when it is the current value',
);

// `isActive` is optional on the Warehouse type; only an explicit false retires
// one, so a row that omits the flag stays listed.
assert.doesNotMatch(
  SRC,
  /filter\(\(w\) => w\.isActive\)/,
  'a missing isActive flag must not retire a warehouse',
);

// Icon-only and decorative SVGs need the right accessibility treatment, and
// the toggles must expose their pressed state to a screen reader.
assert.match(SRC, /aria-pressed=\{isActive\}/, 'the active scope is announced');
assert.match(SRC, /role="group"/, 'the scope buttons are grouped');
assert.match(SRC, /aria-label="Warehouse scope"/, 'the group is named');

// Real buttons, not clickable divs: Tab must reach every scope.
assert.match(SRC, /<button/, 'scopes are real buttons');
assert.doesNotMatch(SRC, /<div[^>]*onClick/, 'no click handler on a bare div');

console.log('✅ warehouse-scope-options tests passed');
