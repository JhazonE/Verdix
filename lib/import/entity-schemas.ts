export type FieldType = 'text' | 'number' | 'boolean';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  aliases: string[];
  default?: string | number | boolean;
}

export type EntityKey = 'products' | 'customers' | 'suppliers';

export interface EntitySchema {
  key: EntityKey;
  label: string;
  fields: FieldDef[];
  matchKeys: string[];
}

export const ENTITY_SCHEMAS: Record<EntityKey, EntitySchema> = {
  products: {
    key: 'products',
    label: 'Products',
    matchKeys: ['barcode', 'name'],
    fields: [
      { key: 'name', label: 'Product Name', type: 'text', required: true, aliases: ['name', 'product', 'product name', 'item', 'item name', 'description name'] },
      { key: 'type', label: 'Product Type', type: 'text', default: 'standard', aliases: ['type', 'product type', 'item type'] },
      { key: 'barcode', label: 'Barcode', type: 'text', aliases: ['barcode', 'bar code', 'upc', 'ean'] },
      { key: 'description', label: 'Description', type: 'text', default: '', aliases: ['description', 'desc', 'details'] },
      { key: 'category', label: 'Category', type: 'text', default: 'General', aliases: ['category', 'cat', 'group'] },
      { key: 'brand', label: 'Brand', type: 'text', aliases: ['brand', 'manufacturer', 'make'] },
      { key: 'subcategory', label: 'Subcategory', type: 'text', aliases: ['subcategory', 'sub category', 'subcat'] },
      { key: 'unit', label: 'Unit', type: 'text', default: 'pcs', aliases: ['unit', 'uom', 'unit of measure', 'measure'] },
      { key: 'cost_price', label: 'Cost Price', type: 'number', default: 0, aliases: ['cost_price', 'cost', 'buy price', 'purchase price'] },
      // 'retail' (bare) is here on purpose. The DEFAULT price level is
      // commonly named "Retail", and it gets no generated column of its own
      // because `selling_price` IS that level's price. Without this alias a
      // sheet headed plainly "Retail" matched nothing and imported as 0,
      // silently wiping the shelf price of every row.
      { key: 'selling_price', label: 'Selling Price', type: 'number', default: 0, aliases: ['selling_price', 'price', 'srp', 'sell price', 'retail price', 'retail'] },
      { key: 'stock_quantity', label: 'Stock Quantity', type: 'number', default: 0, aliases: ['stock_quantity', 'stock', 'qty', 'quantity', 'on hand', 'onhand'] },
      { key: 'reorder_point', label: 'Reorder Point', type: 'number', default: 0, aliases: ['reorder_point', 'reorder', 'rop', 'min stock'] },
      { key: 'image_url', label: 'Image URL', type: 'text', aliases: ['image_url', 'image', 'photo', 'img'] },
      { key: 'conversion_factor', label: 'Conversion Factor', type: 'number', default: 1, aliases: ['conversion_factor', 'conversion', 'factor'] },
    ],
  },
  customers: {
    key: 'customers',
    label: 'Customers',
    matchKeys: ['name', 'contact_number'],
    fields: [
      { key: 'name', label: 'Customer Name', type: 'text', required: true, aliases: ['name', 'customer', 'customer name', 'client'] },
      { key: 'contact_number', label: 'Contact Number', type: 'text', aliases: ['contact_number', 'contact', 'phone', 'mobile', 'tel', 'cellphone'] },
      { key: 'address', label: 'Address', type: 'text', aliases: ['address', 'addr', 'location'] },
      { key: 'billing_address', label: 'Billing Address', type: 'text', aliases: ['billing_address', 'billing', 'bill to'] },
      { key: 'sales_person', label: 'Sales Person', type: 'text', aliases: ['sales_person', 'salesperson', 'agent', 'rep'] },
      { key: 'sales_area', label: 'Sales Area', type: 'text', aliases: ['sales_area', 'area', 'territory'] },
      { key: 'sales_group', label: 'Sales Group', type: 'text', aliases: ['sales_group', 'group'] },
      { key: 'payment_terms', label: 'Payment Terms', type: 'text', aliases: ['payment_terms', 'terms'] },
      { key: 'loyalty_points', label: 'Loyalty Points', type: 'number', default: 0, aliases: ['loyalty_points', 'loyalty', 'points'] },
      { key: 'discount', label: 'Discount', type: 'number', default: 0, aliases: ['discount', 'disc'] },
      { key: 'credit_limit', label: 'Credit Limit', type: 'number', default: 0, aliases: ['credit_limit', 'credit', 'limit'] },
      { key: 'active', label: 'Active', type: 'boolean', default: true, aliases: ['active', 'enabled', 'status'] },
    ],
  },
  suppliers: {
    key: 'suppliers',
    label: 'Suppliers',
    matchKeys: ['name'],
    fields: [
      { key: 'name', label: 'Supplier Name', type: 'text', required: true, aliases: ['name', 'supplier', 'supplier name', 'vendor'] },
      { key: 'contact_number', label: 'Contact Number', type: 'text', aliases: ['contact_number', 'contact', 'phone', 'mobile', 'tel'] },
      { key: 'address', label: 'Address', type: 'text', aliases: ['address', 'addr', 'location'] },
      { key: 'payment_terms', label: 'Payment Terms', type: 'text', aliases: ['payment_terms', 'terms'] },
      { key: 'markup_percentage', label: 'Markup %', type: 'number', aliases: ['markup_percentage', 'markup', 'markup percent'] },
    ],
  },
};

export function templateFields(schema: EntitySchema): FieldDef[] {
  return schema.fields;
}

/**
 * A price level the import can carry a column for.
 * Mirrors the `price_levels` row the resolver in lib/pricing.ts reads.
 */
export interface ImportPriceLevel {
  id: string;
  name: string;
  isDefault: boolean;
}

/** Field key for a level's column, e.g. "Wholesale" -> price_wholesale. */
export function priceLevelFieldKey(level: ImportPriceLevel): string {
  return `price_level__${level.id}`;
}

/** The price-level field keys present in a schema, paired with their level id. */
export function priceLevelFieldsOf(schema: EntitySchema): Array<{ key: string; levelId: string }> {
  return schema.fields
    .filter((f) => f.key.startsWith('price_level__'))
    .map((f) => ({ key: f.key, levelId: f.key.slice('price_level__'.length) }));
}

/**
 * Products schema plus one optional numeric column per configured price level.
 *
 * Levels are resolved at runtime from the `price_levels` table rather than
 * hard-coded, so adding a level in Settings makes its column appear in the
 * template, the column mapper and the export without a code change.
 *
 * The DEFAULT level is deliberately skipped: its base-unit row IS the product's
 * shelf price, which the existing `selling_price` column already carries. Giving
 * it a second column would let one file set two different values for one price
 * with no defined winner.
 *
 * A level whose name collides with an existing field key (or another level,
 * after normalisation) is skipped — auto-map matches on normalised header text,
 * so two fields answering to the same header would make mapping ambiguous.
 */
export function productsSchemaWithPriceLevels(levels: ImportPriceLevel[]): EntitySchema {
  const base = ENTITY_SCHEMAS.products;
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

  const taken = new Set<string>();
  for (const f of base.fields) {
    taken.add(norm(f.key));
    for (const a of f.aliases) taken.add(norm(a));
  }

  const extra: FieldDef[] = [];
  for (const level of levels) {
    if (level.isDefault) continue;
    const label = level.name.trim();
    if (!label) continue;

    // Headers a user would plausibly write for this level.
    const aliases = [
      `price ${label}`,
      `${label} price`,
      `price_${label}`,
      label,
    ];
    if (aliases.some((a) => taken.has(norm(a)))) continue;
    for (const a of aliases) taken.add(norm(a));

    extra.push({
      key: priceLevelFieldKey(level),
      label: `${label} Price`,
      type: 'number',
      aliases,
      // No default: an unmapped or blank cell must leave the level's existing
      // price alone, not overwrite it with 0. classifyRows only sets a value
      // when a field has a default, so omitting one is what makes blank mean
      // "leave as is" all the way through to the route.
    });
  }

  if (extra.length === 0) return base;
  return { ...base, fields: [...base.fields, ...extra] };
}
