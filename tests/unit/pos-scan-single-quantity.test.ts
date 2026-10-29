import assert from 'node:assert/strict';

// A barcode scan sometimes landed in the cart as quantity 2 instead of 1.
//
// Root cause: TWO independent paths add a scanned exact-code match, and both
// can fire for a single scan.
//
//   1. PosCartTable's auto-add effect, which runs on every [inputValue,
//      findExactCodeMatch, handleAddItem] change and calls handleAddItem as
//      soon as the code resolves.
//   2. The Enter key handler, which calls handleAddItemBySKU when
//      inputValue.trim() is still non-empty.
//
// The effect clears inputValue via setInputValue(''), but React batches that
// state update. A scanner emits the digits and its trailing Enter within a few
// milliseconds, so the Enter keydown can be dispatched BEFORE the cleared
// value has been committed and re-rendered into the input. The handler then
// still sees the old non-empty inputValue, takes the `handleAddItemBySKU`
// branch, and adds the very same product a second time.
//
// `justAutoAddedRef` does not help: it is only consulted in the
// already-cleared (empty input) branch, which is precisely the case that does
// NOT double-add.
//
// A second trigger exists even without the keyboard: findExactCodeMatch is a
// useCallback over `products`, and useProducts returns a freshly-mapped array
// on every 30s refetch. A refetch that lands while the scanned code is still
// in the box gives the effect a new identity and re-runs it on an unchanged
// inputValue, adding the product again.
//
// Fix: the auto-add effect records which code it has already consumed, so
// neither a re-run on an unchanged value nor a racing Enter can add it twice.

// ─── A model of the component's add paths ────────────────────────────────
// Mirrors the real sequencing: effects observe the LAST COMMITTED inputValue,
// while a keydown dispatched before the next paint also still sees it.
type Harness = {
  cart: Map<string, number>;
  inputValue: string;
  committedInput: string;
};

const PRODUCT = { id: 'p1', barcode: '4800016641503', name: 'Bear Brand 33g' };

function makeHarness(): Harness {
  return { cart: new Map(), inputValue: '', committedInput: '' };
}

function findExactCodeMatch(q: string) {
  return q.trim().toLowerCase() === PRODUCT.barcode ? PRODUCT : undefined;
}

function addToCart(h: Harness, productId: string) {
  h.cart.set(productId, (h.cart.get(productId) ?? 0) + 1);
}

// The fix under test: the effect remembers the code it already consumed.
// Cleared independently of React's batching, so it is correct even when the
// input's cleared value has not yet been committed.
let consumedCode: string | null = null;

function autoAddEffect(h: Harness) {
  const match = findExactCodeMatch(h.committedInput);
  if (!match) return;
  const code = h.committedInput.trim().toLowerCase();
  if (consumedCode === code) return; // already added for this exact scan
  consumedCode = code;
  addToCart(h, match.id);
  h.inputValue = ''; // setInputValue('') — NOT yet committed
}

function onEnter(h: Harness) {
  // The handler reads the value React has committed, which during a scanner's
  // trailing Enter can still be the pre-clear text.
  if (h.committedInput.trim()) {
    const code = h.committedInput.trim().toLowerCase();
    if (consumedCode === code) {
      // Already consumed by the auto-add effect — swallow this Enter.
      consumedCode = null;
      h.inputValue = '';
      h.committedInput = '';
      return;
    }
    const match = findExactCodeMatch(code);
    if (match) addToCart(h, match.id);
    h.inputValue = '';
    h.committedInput = '';
    return;
  }
  consumedCode = null;
}

function commit(h: Harness) {
  h.committedInput = h.inputValue;
}

// ─── 1. scan + trailing Enter before the clear commits → quantity 1 ──────
// The exact race a hardware scanner produces.
{
  const h = makeHarness();
  consumedCode = null;

  h.inputValue = PRODUCT.barcode;
  commit(h);        // input renders with the barcode
  autoAddEffect(h); // effect adds it, requests the clear
  onEnter(h);       // scanner's Enter — committedInput is STILL the barcode

  assert.equal(
    h.cart.get(PRODUCT.id),
    1,
    'a scanned barcode whose trailing Enter arrives before the cleared input ' +
      'commits must add quantity 1, not 2',
  );
}

// ─── 2. a products refetch re-running the effect → quantity 1 ────────────
// findExactCodeMatch gets a new identity on every 30s useProducts refetch.
{
  const h = makeHarness();
  consumedCode = null;

  h.inputValue = PRODUCT.barcode;
  commit(h);
  autoAddEffect(h);
  autoAddEffect(h); // re-run from dependency identity churn, same inputValue

  assert.equal(
    h.cart.get(PRODUCT.id),
    1,
    'a products refetch re-running the auto-add effect on an unchanged ' +
      'inputValue must not add the product a second time',
  );
}

// ─── 3. deliberately scanning the SAME item twice → quantity 2 ───────────
// The guard must not swallow a genuine second scan.
{
  const h = makeHarness();
  consumedCode = null;

  h.inputValue = PRODUCT.barcode;
  commit(h);
  autoAddEffect(h);
  onEnter(h); // completes the first scan, clearing the box

  commit(h);  // box is now genuinely empty

  h.inputValue = PRODUCT.barcode; // cashier scans the same item again
  commit(h);
  autoAddEffect(h);
  onEnter(h);

  assert.equal(
    h.cart.get(PRODUCT.id),
    2,
    'scanning the same item twice must still bump the line to quantity 2',
  );
}

// ─── 4. typing a code and pressing Enter manually → quantity 1 ───────────
// No scanner: the effect already fired on the last committed keystroke.
{
  const h = makeHarness();
  consumedCode = null;

  for (let i = 1; i <= PRODUCT.barcode.length; i++) {
    h.inputValue = PRODUCT.barcode.slice(0, i);
    commit(h);
    autoAddEffect(h); // only the final, complete code matches
  }
  onEnter(h);

  assert.equal(
    h.cart.get(PRODUCT.id),
    1,
    'typing a full barcode then pressing Enter must add quantity 1',
  );
}

// ─── 5. the real component carries the guard on BOTH add paths ───────────
// The model above proves the logic; these assertions prove PosCartTable
// actually implements it, so the fix cannot be reverted silently.
import fs from 'node:fs';
import path from 'node:path';

const stripComments = (s: string) =>
  s
    .replace(/\r\n/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

const table = stripComments(
  fs.readFileSync(
    path.join(__dirname, '../..', 'app/(app)/pos/pos-content/PosCartTable.tsx'),
    'utf-8',
  ),
);

assert.ok(
  /autoAddedCodeRef\s*=\s*useRef/.test(table),
  'PosCartTable tracks which code the auto-add effect already carted, in a ' +
    'ref so a racing Enter in the same commit can see it',
);

// The effect must bail when the code it is seeing is the one it already added,
// which is what stops a products refetch from re-adding on an unchanged value.
assert.ok(
  /if\s*\(\s*autoAddedCodeRef\.current\s*===\s*code\s*\)\s*return/.test(table),
  'the auto-add effect ignores a re-run for a code it has already added',
);

// The Enter handler's non-empty branch must consult the same ref BEFORE it
// reaches handleAddItemBySKU — that ordering is the whole fix for the scanner
// race. Assert the guard appears ahead of the add call in that branch.
const enterBranch = table.slice(table.indexOf("if (inputValue.trim())"));
const guardAt = enterBranch.indexOf('autoAddedCodeRef.current ===');
const addAt = enterBranch.indexOf('handleAddItemBySKU(');
assert.ok(guardAt !== -1, "the Enter handler's non-empty branch checks the ref");
assert.ok(addAt !== -1, 'the Enter handler still adds genuinely new codes');
assert.ok(
  guardAt < addAt,
  'the already-added check runs BEFORE handleAddItemBySKU, so a scanner Enter ' +
    'that races the input clear cannot add a second piece',
);

console.log('✓ pos-scan-single-quantity');
