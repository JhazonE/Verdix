import assert from 'node:assert/strict';
import { calloutMarkup, calloutOverlayCss } from '../../scripts/manual/overlay';

const two = calloutMarkup([{ n: 1, x: 10, y: 20 }, { n: 2, x: 30, y: 40 }]);
assert.equal((two.match(/manual-callout-badge/g) ?? []).length, 2, 'one badge per callout');
assert.ok(two.includes('>1<'), 'badge 1 rendered');
assert.ok(two.includes('>2<'), 'badge 2 rendered');

const one = calloutMarkup([{ n: 1, x: 10, y: 20 }]);
assert.ok(one.includes('left:10px'), 'badge positioned on x');
assert.ok(one.includes('top:20px'), 'badge positioned on y');

assert.equal(calloutMarkup([]), '', 'no callouts renders nothing');

// The overlay is injected into a page being screenshotted; an external fetch
// could stall or fail the capture.
const css = calloutOverlayCss();
assert.ok(css.includes('.manual-callout-badge'), 'badge class defined');
assert.ok(!css.includes('@import'), 'overlay CSS must not fetch external resources');

console.log('manual-overlay: all assertions passed');
