'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import type { PriceLevel } from '@/lib/types';

import { usePriceLevelForm, type PriceLevelSaveHandler } from './use-price-level-form';

export function PriceLevelForm({
  initialData,
  onSave,
  onCancel,
}: {
  initialData?: PriceLevel;
  onSave: PriceLevelSaveHandler;
  onCancel: () => void;
}) {
  const {
    name,
    setName,
    description,
    setDescription,
    isDefault,
    setIsDefault,
    calculationBase,
    setCalculationBase,
    adjustmentType,
    setAdjustmentType,
    percentageAdjustment,
    setPercentageAdjustment,
    isSaving,
    handleSave,
  } = usePriceLevelForm({ initialData, onSave });

  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="name" className="text-right">
          Name
        </Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="col-span-3"
          placeholder="e.g., Wholesale"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="description" className="text-right">
          Description
        </Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="col-span-3"
          placeholder="Optional description"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="adjustmentType" className="text-right">
          Adjustment Type
        </Label>
        <div className="col-span-3">
          <Select value={adjustmentType} onValueChange={(val: 'percentage' | 'fixed') => setAdjustmentType(val)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Percentage</SelectItem>
              <SelectItem value="fixed">Fixed Amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="adjustment" className="text-right">
          {adjustmentType === 'fixed' ? 'Fixed Amount (₱)' : 'Markup %'}
        </Label>
        <Input
          id="adjustment"
          type="number"
          value={percentageAdjustment}
          onChange={(e) => setPercentageAdjustment(e.target.value)}
          className="col-span-3"
          placeholder={adjustmentType === 'fixed' ? 'e.g., 20 for ₱20 added' : 'e.g., 20 for 20% markup'}
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="calculationBase" className="text-right">
          Base On
        </Label>
        <div className="col-span-3">
          <Select value={calculationBase} onValueChange={(val: 'retail' | 'cost') => setCalculationBase(val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select calculation base" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="retail">Retail Target Price</SelectItem>
              <SelectItem value="cost">Product Cost</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1 text-right">
            {calculationBase === 'retail'
              ? (adjustmentType === 'fixed' ? 'Adds a fixed amount on top of the calculated Retail price.' : 'Applies markup/discount on top of the calculated Retail price.')
              : (adjustmentType === 'fixed' ? 'Adds a fixed amount on top of the base Cost.' : 'Applies markup/discount on top of the base Cost.')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="isDefault" className="text-right">
          Default
        </Label>
        <div className="flex items-center space-x-2 col-span-3">
          <Checkbox
            id="isDefault"
            checked={isDefault}
            onCheckedChange={(checked) => setIsDefault(!!checked)}
          />
          <Label htmlFor="isDefault" className="text-sm font-normal">Apply as default for new customers</Label>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isSaving ? 'Saving...' : (initialData ? 'Update Price Level' : 'Add Price Level')}
        </Button>
      </div>
    </div>
  );
}
