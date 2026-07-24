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
            <Label htmlFor="showQuantityInSearch">Show Quantity in Search Product</Label>
            <p className="text-sm text-muted-foreground">Display product quantity in the POS product search dialog</p>
          </div>
          <Switch id="showQuantityInSearch" checked={!!settings.showQuantityInSearch} onCheckedChange={v => set('showQuantityInSearch', v)} />
        </div>
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="space-y-0.5">
            <Label htmlFor="enableNegativeInventory">Allow Negative Inventory</Label>
            <p className="text-sm text-muted-foreground">Allow sales even when stock is insufficient</p>
          </div>
          <Switch id="enableNegativeInventory" checked={!!settings.enableNegativeInventory} onCheckedChange={v => set('enableNegativeInventory', v)} />
        </div>
      </CardContent>
    </Card>
  );
}
