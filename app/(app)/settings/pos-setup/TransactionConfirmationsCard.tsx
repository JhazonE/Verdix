'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ClipboardCheck } from 'lucide-react';
import type { PosSettings } from './pos-setup-types';

type SetFn = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => void;

const CONFIRMATIONS: { key: keyof PosSettings; label: string; desc: string }[] = [
  { key: 'requireAdjustmentConfirmation',    label: 'Stock Adjustment Confirmation',   desc: 'Confirm before saving manual stock adjustments' },
  { key: 'requireTransferConfirmation',       label: 'Stock Transfer Confirmation',     desc: 'Confirm before processing shelf-to-shelf transfers' },
  { key: 'requirePurchaseOrderConfirmation',  label: 'Purchase Order Confirmation',     desc: 'Confirm before creating a new purchase order' },
  { key: 'requireReceiveConfirmation',        label: 'Receive PO Confirmation',         desc: 'Confirm before receiving stock from a purchase order' },
  { key: 'requireBadOrderConfirmation',       label: 'Bad Order Confirmation',          desc: 'Confirm before recording items as bad orders (damages/returns)' },
  { key: 'requireStockCountApproval',         label: 'Stock Count Approval',            desc: 'Require multi-level approval before applying stock count variances' },
  { key: 'requireRepackagingConfirmation',    label: 'Repackaging Approval',            desc: 'Require multi-level approval before executing stock repackaging conversions' },
  { key: 'requireShelfTransferApproval',      label: 'Shelf Transfer Approval',         desc: 'Require multi-level approval before moving stock between shelves' },
  { key: 'requireProductConfirmation',        label: 'Add Product Approval',            desc: 'Require multi-level approval before a new product is created' },
  { key: 'requirePriceUpdateConfirmation',    label: 'Bulk Price Update Approval',      desc: 'Require multi-level approval before bulk price changes are applied' },
];

interface Props { settings: PosSettings; set: SetFn; }

export function TransactionConfirmationsCard({ settings, set }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Transaction Confirmations</CardTitle>
        <CardDescription>Require confirmation before processing transactions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {CONFIRMATIONS.map(({ key, label, desc }, i) => (
          <div key={key} className={`flex items-center justify-between${i > 0 ? ' pt-4 border-t' : ''}`}>
            <div className="space-y-0.5">
              <Label htmlFor={key}>{label}</Label>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
            <Switch id={key} checked={!!settings[key]} onCheckedChange={v => set(key, v as any)} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
