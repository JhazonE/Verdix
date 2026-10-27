import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Per-warehouse opening stock is entered on rows rendered by
 * `InlineEditableMultiSelect` via its `renderRowAccessory` callback.
 *
 * `FormDescription`, `FormMessage`, `FormLabel` and `FormControl` all call
 * `useFormField()`, which THROWS "useFormField should be used within
 * <FormField>" at runtime when that ancestor is missing. It type-checks fine,
 * so only a render (or this test) catches it; it crashed the whole Add Product
 * dialog on open once already.
 *
 * The multi-select is always rendered inside a `<FormField><FormItem>` pair by
 * its callers, so the single `FormControl` it wraps its TRIGGER in does resolve
 * — that one is fine and is deliberately allowed below. What must stay
 * context-free is the POPOVER BODY: the rows, and the accessories callers
 * render into them. Those are passed in as a callback and rendered in a
 * portalled popover, so the form primitives are far less obviously reachable
 * there, and a caller with no form context of its own would crash outright.
 */

const root = path.join(__dirname, '..', '..');

const read = (...segments: string[]) =>
  readFileSync(path.join(root, ...segments), 'utf8');

/**
 * Strip comments before matching: these files deliberately NAME the components
 * when explaining why they must not be used, and that prose must not trip the
 * check.
 */
const stripComments = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const CONTEXT_DEPENDENT = ['FormDescription', 'FormMessage', 'FormLabel', 'FormControl'];

// --- the shared control that renders the rows ------------------------------

const multiSelect = stripComments(
  read('app', '(app)', 'products', 'components', 'inline-editable-multi-select.tsx'),
);

// The popover body starts at <PopoverContent>; everything before it is the
// trigger, whose single FormControl is legitimate (every caller renders this
// control inside a FormField).
const popoverStart = multiSelect.indexOf('<PopoverContent');
assert.ok(popoverStart > -1, 'the multi-select is expected to render a PopoverContent');
const popoverBody = multiSelect.slice(popoverStart);

for (const component of CONTEXT_DEPENDENT) {
  assert.ok(
    !new RegExp(`<${component}[\\s/>]`).test(popoverBody),
    `${component} calls useFormField() and must not be rendered in the popover body, where row accessories live`,
  );
}

// FormControl around the trigger is the ONE allowed use, so pin it: if a
// second one appears, the assumption above needs re-checking.
assert.equal(
  (multiSelect.match(/<FormControl[\s>]/g) ?? []).length,
  1,
  'only the trigger may be wrapped in FormControl',
);

// The rows are rendered through a callback, which is what puts them outside
// the caller's FormField subtree even when the caller has one.
assert.match(
  multiSelect,
  /renderRowAccessory\?\.\(/,
  'row accessories are expected to render via the renderRowAccessory callback',
);

// --- the Add Product caller's accessory ------------------------------------

const inventoryTab = stripComments(
  read('app', '(app)', 'products', 'add-product', 'tabs', 'inventory-tab.tsx'),
);

const accessoryStart = inventoryTab.indexOf('renderRowAccessory');
assert.ok(accessoryStart > -1, 'Add Product is expected to pass a renderRowAccessory');

// The accessory runs to the end of the prop list it sits in; the closing of the
// enclosing JSX element is a safe outer bound for the scan.
const accessoryBlock = inventoryTab.slice(
  accessoryStart,
  inventoryTab.indexOf('/>', accessoryStart) + 2,
);

for (const component of CONTEXT_DEPENDENT) {
  assert.ok(
    !new RegExp(`<${component}[\\s/>]`).test(accessoryBlock),
    `${component} must not be rendered inside renderRowAccessory — it has no FormField ancestor there`,
  );
}

// The stock input must still be labelled for assistive tech even without a
// FormLabel, since the plain element carries no association of its own.
assert.match(
  accessoryBlock,
  /aria-label=/,
  'the per-warehouse stock input needs an aria-label in place of a FormLabel',
);

// --- and the contract that makes the above true ---------------------------

const formPrimitives = read('components', 'ui', 'form.tsx');

assert.ok(
  /const useFormField = \(\) => \{[\s\S]*?throw new Error\("useFormField should be used within <FormField>"\)/.test(
    formPrimitives,
  ),
  'useFormField still throws without a FormField ancestor — if this changed, the rule above can be revisited',
);

for (const component of ['FormDescription', 'FormMessage']) {
  const body = formPrimitives.slice(formPrimitives.indexOf(`const ${component} =`));
  assert.ok(
    body.slice(0, body.indexOf('})')).includes('useFormField()'),
    `${component} is expected to depend on useFormField()`,
  );
}

console.log('✅ form-context-free-field-array tests passed');
