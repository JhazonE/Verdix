'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdjustmentType } from '@/lib/price-update-math';
import type { TargetField } from '@/app/(app)/products/bulk-price-update/use-bulk-price-update';

export interface PricingConfigFieldsProps {
  compact?: boolean;
  warehouses: { id: string; name: string }[];
  priceLevels: { id: string; name: string }[];
  warehouseId: string;
  setWarehouseId: (id: string) => void;
  targetField: TargetField;
  setTargetField: (f: TargetField) => void;
  adjustmentType: AdjustmentType;
  setAdjustmentType: (t: AdjustmentType) => void;
  priceLevelId: string;
  onPriceLevelChange: (id: string) => void;
  adjustmentValue: number;
  setAdjustmentValue: (v: number) => void;
  onDownloadTemplate: () => void;
  onOpenUpload: () => void;
}

export function PricingConfigFields({
  compact,
  warehouses,
  priceLevels,
  warehouseId,
  setWarehouseId,
  targetField,
  setTargetField,
  adjustmentType,
  setAdjustmentType,
  priceLevelId,
  onPriceLevelChange,
  adjustmentValue,
  setAdjustmentValue,
  onDownloadTemplate,
  onOpenUpload,
}: PricingConfigFieldsProps) {
  const gap = compact ? 'space-y-4' : 'space-y-5';

  return (
    <div className={gap}>
      <div className="grid gap-2">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Warehouse
        </Label>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className={cn(compact ? 'h-10' : 'h-11')}>
            <SelectValue placeholder="Select a warehouse" />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map(w => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!warehouseId ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Choose a warehouse to load its products.
        </p>
      ) : (
        <>
          <div className="grid gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Target Field
            </Label>
            <Select value={targetField} onValueChange={(v: any) => setTargetField(v)}>
              <SelectTrigger className={cn(compact ? 'h-10' : 'h-11')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="price">Selling Price</SelectItem>
                <SelectItem value="cost">Cost</SelectItem>
                <SelectItem value="markup">Recalculate from Markup %</SelectItem>
                <SelectItem value="priceLevel">Price Level</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Adjustment Type
            </Label>
            <Select
              value={targetField === 'markup' ? 'markup' : adjustmentType}
              onValueChange={(v: any) => setAdjustmentType(v)}
              disabled={targetField === 'markup'}
            >
              <SelectTrigger className={cn(compact ? 'h-10' : 'h-11')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage (%)</SelectItem>
                <SelectItem value="fixed">Fixed Amount (₱)</SelectItem>
                <SelectItem value="exact">Set Exact Value</SelectItem>
                {targetField === 'markup' && <SelectItem value="markup">Markup %</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {targetField === 'priceLevel' && (
            <div className="grid gap-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Price Level
              </Label>
              <Select value={priceLevelId} onValueChange={onPriceLevelChange}>
                <SelectTrigger className={cn(compact ? 'h-10' : 'h-11')}>
                  <SelectValue placeholder="Select a price level" />
                </SelectTrigger>
                <SelectContent>
                  {priceLevels.map(pl => (
                    <SelectItem key={pl.id} value={pl.id}>{pl.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {targetField === 'markup' ? 'Target Markup %' : 'Value'}
            </Label>
            <Input
              type="number"
              className={cn(compact ? 'h-10' : 'h-11')}
              value={adjustmentValue}
              onChange={e => setAdjustmentValue(parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="pt-2 border-t border-border space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Price List
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 gap-2"
                onClick={onDownloadTemplate}
              >
                <Download className="h-3.5 w-3.5" />
                Template
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 gap-2"
                onClick={onOpenUpload}
              >
                <Upload className="h-3.5 w-3.5" />
                Upload
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
