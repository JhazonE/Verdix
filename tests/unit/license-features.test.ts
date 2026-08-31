import assert from 'node:assert/strict';
import { hasFeatureIn } from '../../lib/licensing/features';

assert.equal(hasFeatureIn(['cloud-sync', 'reports'], 'cloud-sync'), true, 'present feature');
assert.equal(hasFeatureIn(['cloud-sync'], 'reports'), false, 'absent feature');

// A license with no features array grants nothing.
assert.equal(hasFeatureIn(undefined, 'cloud-sync'), false, 'undefined features grants nothing');
assert.equal(hasFeatureIn([], 'cloud-sync'), false, 'empty features grants nothing');

// Matching is case-insensitive and tolerates surrounding whitespace.
assert.equal(hasFeatureIn(['Cloud-Sync'], 'cloud-sync'), true, 'case-insensitive');
assert.equal(hasFeatureIn([' cloud-sync '], 'cloud-sync'), true, 'trims whitespace');

console.log('license-features: all assertions passed');
