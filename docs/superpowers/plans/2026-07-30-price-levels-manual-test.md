# Price Levels Auto-Calculation — Manual Testing Checklist

**Date:** 2026-07-30
**Feature:** Product price levels auto-calculation with calculation base selection

## Pre-Test Setup

1. Ensure the dev server is running: `npm run dev`
2. Ensure price levels are defined in the system with various percentage adjustments (e.g., Wholesale +20%, Distributor -10%, Retail 0%)
3. Open browser DevTools console to check for errors

## Test Scenarios

### Scenario 1: Add Product with Price Level Override (Retail Base)

**Steps:**
1. Navigate to Products → Add Product
2. Fill basic info:
   - Name: "Test Product 1"
   - SKU: "TEST-001"
   - Price: ₱100
   - Cost: ₱50
3. Go to "Price Levels" tab
4. Click "Add Level Price"
5. Select "Wholesale" level (or another with +20% adjustment)
6. Verify Calculation Base defaults to "Retail Price"
7. Verify Price field auto-fills to ₱120 (100 × 1.20)

**Expected Result:** ✓ Price auto-calculates on level selection

---


### Scenario 2: Base Price Recalculation

**Steps:**
1. Navigate to Products → Add Product
2. Fill basic info:
   - Name: "Test Product 2"
   - SKU: "TEST-002"
   - Price: ₱100
   - Cost: ₱50
3. Go to "Price Levels" tab
4. Add a price level with Retail-base calculation (e.g., +20% markup):
   - Verify price auto-fills to ₱120
5. Add another price level with Cost-base calculation (e.g., +15% markup):
   - Verify price auto-fills to ₱57.50 (50 × 1.15)
6. Go back to "Basic Info" tab
7. Change Price to ₱200
8. Go back to "Price Levels" tab
9. Verify:
   - Retail-base level updated to ₱240 (200 × 1.20) ✓
   - Cost-base level unchanged at ₱57.50 (cost not changed) ✓

**Expected Result:** ✓ Retail-base levels recalculate when price changes; cost-base levels don't (unless cost changed)

---

### Scenario 3: Edit Product with Existing Price Levels

**Steps:**
1. Navigate to Products list
2. Find a product with price levels and click Edit
3. Go to "Price Levels" tab
4. Verify existing levels display with their levelIds and calculation bases populated
5. Change the base Price in "Basic Info"
6. Return to "Price Levels"
7. Verify price levels recalculated

**Expected Result:** ✓ Edit flow mirrors add flow; recalculation works

---

### Scenario 4: Edge Cases

**Test 1 — Zero Markup:**
- Add a level with 0% adjustment
- Verify price equals base price

**Test 2 — Negative Adjustment:**
- Add a level with -10% adjustment (discount)
- Verify price is less than base price

**Test 3 — Delete Price Level:**
- Add a row, then click the X button
- Verify row is removed without errors

**Test 4 — No Level Selected:**
- Add a row but don't select a level
- Verify Price field stays at 0 (or empty)
- Verify no errors in console

**Expected Result:** ✓ All edge cases handled gracefully

---

### Scenario 5 — Browser Console Check

**During all tests:**
- Open DevTools (F12)
- Check the Console tab
- Verify NO errors, warnings, or TypeErrors related to:
  - `calculatePriceLevelPrice`
  - `priceLevels`
  - `calculationBase`
  - Form validation

**Expected Result:** ✓ Clean console, no errors

---

## Regression Testing

**After all feature tests pass, verify existing functionality still works:**

1. **Add product without price levels** → works normally
2. **Edit existing products** → price levels tab doesn't break if empty
3. **Other tabs (Conversion, Loyalty, etc.)** → unaffected

**Expected Result:** ✓ No regressions

---

## Sign-Off Checklist

- [ ] All scenarios 1–5 pass
- [ ] Browser console is clean (no errors)
- [ ] No regressions in existing features
- [ ] Top "Select Price Level" dropdown is removed
- [ ] No Calculation Base dropdown in rows (uses level's pre-configured base)
- [ ] Auto-calculation works on level selection (using configured calculation base)
- [ ] Recalculation works when main price/cost changes
- [ ] Documentation (USER_GUIDE.md) reflects the new workflow

## Notes

If any test fails:
1. Check browser console for specific errors
2. Verify price level definitions exist in the database
3. Check that the form has valid price/cost values before testing
4. Re-run `npm run dev` if you suspect a stale build
