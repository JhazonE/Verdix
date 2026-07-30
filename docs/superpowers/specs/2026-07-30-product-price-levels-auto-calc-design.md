# Product Price Levels — Auto-Calculation & Streamlined UI

**Date:** 2026-07-30  
**Status:** Approved design, ready for planning

## Problem

The Price Levels tab on product add/edit has two disconnected UI elements:

1. A "Select Price Level" dropdown at the top that sets `selectedPriceLevelId` but doesn't do anything with it
2. A separate "Add Level Price" button below that lets you manually add overrides

This creates confusion: the top selector appears functional but is orphaned. Users have to:
- Select a price level from the top dropdown
- Then manually re-select it in the row and enter a price by hand
- The percentage adjustment on the price level definition is never used

## Operating context

Each price level definition has a `percentageAdjustment` (e.g., +20%) that is meant to be applied to a base price (either retail or cost). Currently this is data that exists but is not used during product pricing. Users want to:

1. Remove the confusing top selector
2. When adding a price level, auto-calculate the price using the level's percentage adjustment
3. Have the price recalculate whenever the base price or cost changes
4. Choose per-row whether to calculate from retail or cost price

## Solution — inline calculation with dual base support

Remove the orphaned top dropdown. When "Add Level Price" is clicked, append a new row with:
- **Level** dropdown (select price level from definitions)
- **Calculation Base** dropdown (Retail / Cost)
- **Price** field (auto-populated based on level + base, user can override)
- **Min Qty** field (quantity break threshold, optional)
- **Delete** button

Auto-calculation formula:
```
newPrice = selectedBasePrice × (1 + level.percentageAdjustment / 100)
```

Where `selectedBasePrice` is either `form.price` (retail) or `form.cost` depending on the row's `calculationBase` setting.

**Recalculation triggers:**
- When user selects a new `levelId` in a row
- When user changes `calculationBase` in a row
- When the main form's `price` field changes (affects all Retail-base rows)
- When the main form's `cost` field changes (affects all Cost-base rows)

User can override the price field after auto-calculate; the form accepts it as-is.

## Components

### 1. Schema update — add `calculationBase` field

In [`app/(app)/products/add-product/product-schema.ts`](../../../app/(app)/products/add-product/product-schema.ts) and [`edit-product/product-schema.ts`](../../../app/(app)/products/edit-product/product-schema.ts):

```ts
priceLevels: z.array(
  z.object({
    levelId: z.string().min(1, 'Level is required'),
    calculationBase: z.enum(['retail', 'cost']).default('retail'),
    price: z.number().min(0),
    minQuantity: z.number().int().min(0).optional(),
  })
)
```

### 2. Remove top selector UI

In [`app/(app)/products/add-product/tabs/price-levels-tab.tsx`](../../../app/(app)/products/add-product/tabs/price-levels-tab.tsx):

- Delete lines 24–54 (the "Select Price Level" box with `selectedPriceLevelId` state)
- Delete the corresponding `selectedPriceLevelId` and `setSelectedPriceLevelId` from the context destructuring

In [`app/(app)/products/edit-product/tabs/price-levels-tab.tsx`](../../../app/(app)/products/edit-product/tabs/price-levels-tab.tsx):

- Same removals as add-product

### 3. Add `calculationBase` row selector

In both price-levels-tab files, modify the row rendering (around line 82–179 in add-product):

After the existing **Level** field, add a **Calculation Base** dropdown:

```tsx
<div className="flex-1">
  <FormField
    control={form.control}
    name={`priceLevels.${index}.calculationBase`}
    render={({ field }) => (
      <FormItem>
        <FormLabel className="text-xs">Calculation Base</FormLabel>
        <Select onValueChange={field.onChange} value={field.value}>
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder="Select base" />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectItem value="retail">Retail Price</SelectItem>
            <SelectItem value="cost">Cost Price</SelectItem>
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )}
  />
</div>
```

### 4. Auto-calculation logic

Create a new helper in `add-product/use-add-product-form.ts`:

```ts
function calculatePriceLevelPrice(
  levelId: string,
  calculationBase: 'retail' | 'cost',
  priceLevels: PriceLevel[],
  formPrice: number,
  formCost: number
): number {
  const level = priceLevels.find(l => l.id === levelId);
  if (!level) return 0;

  const basePrice = calculationBase === 'retail' ? formPrice : formCost;
  return basePrice * (1 + level.percentageAdjustment / 100);
}
```

### 5. Wire recalculation on field change

In the `useAddProductForm` hook:

**On Level selection change:**
```ts
// In the Level field's onChange handler
const newLevelId = levelId;
const currentBase = form.getValues(`priceLevels.${index}.calculationBase`);
const newPrice = calculatePriceLevelPrice(
  newLevelId,
  currentBase,
  priceLevels,
  form.getValues('price'),
  form.getValues('cost')
);
form.setValue(`priceLevels.${index}.price`, newPrice);
```

**On Calculation Base change:**
```ts
// In the Calculation Base field's onChange handler
const currentLevelId = form.getValues(`priceLevels.${index}.levelId`);
const newPrice = calculatePriceLevelPrice(
  currentLevelId,
  calculationBase,
  priceLevels,
  form.getValues('price'),
  form.getValues('cost')
);
form.setValue(`priceLevels.${index}.price`, newPrice);
```

**On main price or cost change:**
Use `form.watch('price')` and `form.watch('cost')` at the top level; trigger a recalculation loop:
```ts
useEffect(() => {
  const currentPrice = form.getValues('price');
  const currentCost = form.getValues('cost');
  const allPriceLevels = form.getValues('priceLevels');
  
  allPriceLevels.forEach((pl, idx) => {
    const newPrice = calculatePriceLevelPrice(
      pl.levelId,
      pl.calculationBase,
      priceLevels,
      currentPrice,
      currentCost
    );
    form.setValue(`priceLevels.${idx}.price`, newPrice);
  });
}, [watchedPrice, watchedCost, priceLevels]);
```

### 6. "Add Level Price" button behavior

The `appendPriceLevel` call adds a new row with defaults:

```ts
appendPriceLevel({
  levelId: '',
  calculationBase: 'retail',
  price: 0,
  minQuantity: undefined,
})
```

User then selects a `levelId`, and the `onChange` handler (from step 5) triggers auto-calculation to populate the price field. If user changes `calculationBase` before selecting a level, nothing happens (price stays 0). Once `levelId` is set, price auto-fills immediately.

### 7. Edit product — same behavior

Apply all the above changes to [`app/(app)/products/edit-product/tabs/price-levels-tab.tsx`](../../../app/(app)/products/edit-product/tabs/price-levels-tab.tsx) identically. When loading an existing product, the rows display with their saved `calculationBase` and `levelId`.

## Edge cases

1. **No price levels defined yet:** Dropdowns show empty or "Loading..." state; user cannot add a row until levels exist (validation catches it).
2. **Price level deleted in settings:** Existing product rows keep the old `levelId`; it won't appear in dropdown for new rows. Display gracefully on edit (e.g., "Unknown level").
3. **Same level added multiple times:** Allowed; user might want different calculation bases or qty breaks.
4. **Negative percentage adjustment:** Works; results in a discount price.
5. **Zero percentage adjustment:** Works; price equals base price.
6. **User deletes base price field:** Price level rows stay populated but recalculation won't trigger until price is re-entered.

## Testing

**Unit — calculation helper:**
- Retail base with +20% adjustment
- Cost base with −10% adjustment
- Zero adjustment
- Missing level ID (returns 0)

**Integration — add product:**
- Add product with price ₱100 and cost ₱50
- Add a price level with +15% retail → field auto-fills ₱115
- Change calculation base to cost → field updates to ₱57.50
- Edit base price to ₱150 → price level row recalculates to ₱172.50 (retail) or ₱57.50 (cost, unchanged)
- Override price manually → stays at manual value on subsequent base price changes

**Integration — edit product:**
- Load existing product with price levels
- Verify rows display with correct `levelId` and `calculationBase`
- Change base price → rows recalculate
- Delete and re-add a level → new row starts from ₱0 until level is selected

**UI — no top selector:**
- Verify "Select Price Level" section is gone
- Verify "Add Level Price" button adds empty row
- Verify both calculation base options appear and work

## Out of scope

- Bulk re-pricing of all products based on price level changes (separate feature)
- Price history or audit trail for when levels recalculate
- Lock-icon or "auto-calculated" indicator (price is editable; no special marking needed)

## Manual & documentation

Update [`docs/USER_GUIDE.md`](../../USER_GUIDE.md) to describe the new workflow:

> **Adding a Price Level Override**
>
> 1. Click "Add Level Price"
> 2. Select the price level from the dropdown
> 3. Choose whether to calculate from Retail or Cost price
> 4. The price field auto-fills based on the level's percentage adjustment
> 5. (Optional) Set a minimum quantity for this level to apply
> 6. You can manually edit the price if needed

Optionally add a footnote: "Price levels recalculate automatically whenever the base product price or cost changes."
