'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Settings } from 'lucide-react';
import type { PosSettings } from './pos-setup-types';

type SetFn = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => void;

interface Props { settings: PosSettings; set: SetFn; }

export function GeneralSettingsCard({ settings, set }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />General Settings</CardTitle>
        <CardDescription>Configure inventory and operational preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="showQuantityInSearch">Show Quantity in Product Search &amp; Autocomplete</Label>
            <p className="text-sm text-muted-foreground">Display product quantity in the POS product search dialog</p>
          </div>
          <Switch id="showQuantityInSearch" checked={!!settings.showQuantityInSearch} onCheckedChange={v => set('showQuantityInSearch', v)} />
        </div>
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="space-y-0.5">
            <Label htmlFor="enablePriceLevelPicker">Price Level Picker in Edit Price</Label>
            <p className="text-sm text-muted-foreground">Let cashiers set a cart line&apos;s price from a price level, at any quantity</p>
          </div>
          <Switch id="enablePriceLevelPicker" checked={!!settings.enablePriceLevelPicker} onCheckedChange={v => set('enablePriceLevelPicker', v)} />
        </div>
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="space-y-0.5">
            <Label htmlFor="enableNegativeInventory">Allow Negative Inventory</Label>
            <p className="text-sm text-muted-foreground">Allow sales even when stock is insufficient</p>
          </div>
          <Switch id="enableNegativeInventory" checked={!!settings.enableNegativeInventory} onCheckedChange={v => set('enableNegativeInventory', v)} />
        </div>
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="space-y-0.5">
            <Label htmlFor="enableQuickAddCustomer">Enable Quick Add Customer</Label>
            <p className="text-sm text-muted-foreground">Allow cashiers to add a new customer directly from the POS customer drawer</p>
          </div>
          <Switch id="enableQuickAddCustomer" checked={settings.enableQuickAddCustomer !== false} onCheckedChange={v => set('enableQuickAddCustomer', v)} />
        </div>
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="space-y-0.5">
            <Label htmlFor="enableLargeInvoice">Enable Large Invoice Printing</Label>
            <p className="text-sm text-muted-foreground">Show the Print Large Invoice option at checkout. Prints a full-page invoice on 9.5 × 5.5in continuous paper instead of a receipt</p>
          </div>
          <Switch id="enableLargeInvoice" checked={!!settings.enableLargeInvoice} onCheckedChange={v => set('enableLargeInvoice', v)} />
        </div>
      </CardContent>
    </Card>
  );
}
