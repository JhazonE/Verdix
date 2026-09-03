import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Typing in the transfer board's search box made the whole board flicker.
//
// Root cause: both boards render `if (isLoading) return <Spinner/>` — an early
// return that unmounts the ENTIRE board, search input included. The debounced
// search effect calls fetchData on every pause in typing, and fetchData sets
// isLoading = true, so each keystroke tore down and rebuilt the input the user
// was typing into.
//
// Fix: the full-screen spinner must be reserved for the FIRST load. A search
// refresh uses a separate flag that leaves the board (and the focused input)
// mounted.

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../..', rel), 'utf-8');

// CRLF files; strip block/JSX comments before line comments, so prose
// describing the old behaviour cannot satisfy assertions about the code.
const stripComments = (src: string) =>
  src
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');

const hook = stripComments(
  read('app/(app)/inventory/transfer-board/use-transfer-board.ts'),
);
const board = stripComments(
  read('app/(app)/inventory/transfer-board/TransferBoard.tsx'),
);
const shelf = stripComments(
  read('app/(app)/inventory/shelf-board/ShelfBoard.tsx'),
);

// ─── 1. a search must not raise the full-screen loading flag ─────────────
// fetchData is what the debounced search calls. If it unconditionally sets
// isLoading(true), the early-return spinner unmounts the board mid-typing.
for (const [name, src] of [['transfer board', hook], ['shelf board', shelf]] as const) {
  assert.ok(
    !/setIsLoading\(true\);?\s*\n\s*try\s*\{/.test(src),
    `${name}: fetchData no longer flips the full-screen loading flag on every ` +
      `call — that unmounted the board, and the focused search input with it`,
  );
}

// ─── 2. there must be a distinct non-blocking search indicator ───────────
for (const [name, src] of [['transfer board', hook], ['shelf board', shelf]] as const) {
  assert.ok(
    /isSearching/.test(src),
    `${name}: tracks search refreshes separately from the initial load`,
  );
}

// ─── 3. the blocking spinner is reserved for the first load ──────────────
// The invariant that matters is not a particular flag NAME, but that
// setIsLoading(true) is reachable only from the initial load. Assert that
// every setIsLoading(true) is guarded by an `initial` condition, so a search
// refresh can never raise the flag the full-screen early-return keys on.
for (const [name, src] of [['transfer board', hook], ['shelf board', shelf]] as const) {
  const raises = src.match(/setIsLoading\(true\)/g) ?? [];
  assert.ok(raises.length > 0, `${name}: still shows a spinner on first load`);
  assert.ok(
    /if\s*\(\s*initial\s*\)\s*setIsLoading\(true\)/.test(src),
    `${name}: setIsLoading(true) fires only on the initial load, so a search ` +
      `can never trigger the full-screen spinner that unmounts the board`,
  );
  assert.equal(
    raises.length,
    1,
    `${name}: exactly one place raises the blocking loading flag, so no other ` +
      `path can reintroduce the flicker`,
  );
}

// ─── 4. a search must not re-fetch unrelated reference data ──────────────
// Warehouses/shelf locations do not change while typing a product name;
// refetching them per keystroke is wasted work on every search.
assert.ok(
  /warehouses\?activeOnly/.test(hook),
  'transfer board still loads warehouses somewhere',
);
assert.ok(
  !/Promise\.all\(\[[\s\S]{0,200}warehouses\?activeOnly[\s\S]{0,200}buildProductQuery/.test(hook),
  'transfer board does not refetch warehouses on every debounced search',
);
assert.ok(
  !/Promise\.all\(\[[\s\S]{0,200}shelf-locations[\s\S]{0,200}buildProductQuery/.test(shelf),
  'shelf board does not refetch shelf locations on every debounced search',
);

console.log('✓ board-search-no-remount');
