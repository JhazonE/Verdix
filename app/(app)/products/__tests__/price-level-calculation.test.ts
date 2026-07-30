import { describe, it, expect } from 'vitest';
import { calculatePriceLevelPrice } from '../add-product/use-add-product-form';

const mockPriceLevels = [
  { id: 'level1', name: 'Wholesale', percentageAdjustment: 20, isDefault: false, calculationBase: 'retail' },
  { id: 'level2', name: 'Distributor', percentageAdjustment: -10, isDefault: false, calculationBase: 'cost' },
  { id: 'level3', name: 'Retail', percentageAdjustment: 0, isDefault: true, calculationBase: 'retail' },
];

describe('calculatePriceLevelPrice', () => {
  it('should calculate price with positive percentage adjustment (retail base)', () => {
    const result = calculatePriceLevelPrice('level1', 'retail', mockPriceLevels, 100, 50);
    expect(result).toBe(120); // 100 * (1 + 20/100)
  });

  it('should calculate price with negative percentage adjustment (cost base)', () => {
    const result = calculatePriceLevelPrice('level2', 'cost', mockPriceLevels, 100, 50);
    expect(result).toBe(45); // 50 * (1 + (-10)/100)
  });

  it('should calculate price with zero percentage adjustment', () => {
    const result = calculatePriceLevelPrice('level3', 'retail', mockPriceLevels, 100, 50);
    expect(result).toBe(100); // 100 * (1 + 0/100)
  });

  it('should return 0 if levelId is empty', () => {
    const result = calculatePriceLevelPrice('', 'retail', mockPriceLevels, 100, 50);
    expect(result).toBe(0);
  });

  it('should return 0 if levelId does not exist', () => {
    const result = calculatePriceLevelPrice('nonexistent', 'retail', mockPriceLevels, 100, 50);
    expect(result).toBe(0);
  });

  it('should return 0 if base price is undefined', () => {
    const result = calculatePriceLevelPrice('level1', 'retail', mockPriceLevels, undefined as any, 50);
    expect(result).toBe(0);
  });

  it('should handle fractional percentages correctly', () => {
    const levelsWithFractional = [
      { id: 'frac', name: 'Fractional', percentageAdjustment: 15.5, isDefault: false, calculationBase: 'retail' },
    ];
    const result = calculatePriceLevelPrice('frac', 'retail', levelsWithFractional, 200, 100);
    expect(result).toBeCloseTo(231); // 200 * (1 + 15.5/100) = 200 * 1.155 = 231
  });

  it('should use cost price when calculationBase is cost', () => {
    const result = calculatePriceLevelPrice('level1', 'cost', mockPriceLevels, 100, 50);
    expect(result).toBe(60); // 50 * (1 + 20/100)
  });
});
