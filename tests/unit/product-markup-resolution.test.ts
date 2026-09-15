import assert from 'node:assert/strict';
import { calculateMarkupPercentage } from '../../lib/purchase-utils';

// Fixtures: a category that would supply 12% if nothing overrides it.
const settings = {
  enableAutomaticMarkup: true,
  markupPriority: ['subcategory', 'category', 'brand', 'supplier'],
};
const categories = [{ id: 'cat1', name: 'Grocery', markupPercentage: 12 }];
const subcategories: any[] = [];
const brands = [{ id: 'br1', name: 'Acme', markupPercentage: 30 }];
const suppliers = [{ id: 'sup1', name: 'Supplier A', markupPercentage: 40 }];

const resolve = (product: any, s: any = settings) =>
  calculateMarkupPercentage(product, s, categories, subcategories, brands, suppliers);

// --- inheritance still works when there is no override ---
{
  const { markup, source } = resolve({ category: 'Grocery' });
  assert.equal(markup, 12, 'null markup inherits the category markup');
  assert.equal(source, 'Category', 'source names the inherited origin');
}

// --- a per-product markup overrides every inherited source ---
{
  const { markup, source } = resolve({
    markupPercentage: 25,
    category: 'Grocery',
    brand: 'Acme',
    supplierId: 'sup1',
  });
  assert.equal(markup, 25, 'per-product markup wins over category/brand/supplier');
  assert.equal(source, 'Product', 'source is Product for an override');
}

// --- 0 is a real value and does NOT inherit ---
{
  const { markup, source } = resolve({ markupPercentage: 0, category: 'Grocery' });
  assert.equal(markup, 0, '0 means sell at cost, it does not fall through');
  assert.equal(source, 'Product', '0 is still a deliberate product-level entry');
}

// --- null and undefined both mean inherit ---
{
  assert.equal(resolve({ markupPercentage: null, category: 'Grocery' }).markup, 12,
    'null markup inherits');
  assert.equal(resolve({ markupPercentage: undefined, category: 'Grocery' }).markup, 12,
    'undefined markup inherits');
}

// --- the automatic-markup toggle suppresses inheritance but NOT an override ---
{
  const off = { ...settings, enableAutomaticMarkup: false };

  const inherited = resolve({ category: 'Grocery' }, off);
  assert.equal(inherited.markup, 0, 'inherited markup is suppressed when the toggle is off');
  assert.equal(inherited.source, '', 'no source when suppressed');

  const overridden = resolve({ markupPercentage: 25, category: 'Grocery' }, off);
  assert.equal(overridden.markup, 25,
    'a deliberate per-product markup survives the automatic-markup toggle being off');
  assert.equal(overridden.source, 'Product', 'source is still Product');
}

// --- a non-numeric override is ignored rather than producing NaN ---
{
  const { markup } = resolve({ markupPercentage: NaN as any, category: 'Grocery' });
  assert.equal(markup, 12, 'NaN is not a usable override, fall through to inheritance');
}

console.log('✅ product-markup-resolution tests passed');
