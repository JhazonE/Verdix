'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Lock } from 'lucide-react';
import type { PosSettings } from './pos-setup-types';

type SetFn = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => void;

type AuthConfig = {
  enableKey: keyof PosSettings;
  usernameKey: keyof PosSettings;
  passwordKey: keyof PosSettings;
  label: string;
  desc: string;
  userPlaceholder: string;
  passPlaceholder: string;
};

const AUTH_CONFIGS: AuthConfig[] = [
  { enableKey: 'enableLineVoidAuth',      usernameKey: 'lineVoidAuthUsername',      passwordKey: 'lineVoidAuthPassword',      label: 'Line Void Authentication',         desc: 'Require credentials to remove an item',                       userPlaceholder: 'e.g. admin',      passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableVoidReturnAuth',    usernameKey: 'voidAuthUsername',           passwordKey: 'voidAuthPassword',           label: 'Post Void Authentication',          desc: 'Require credentials to process voids',                        userPlaceholder: 'e.g. admin',      passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableReturnAuth',        usernameKey: 'returnAuthUsername',         passwordKey: 'returnAuthPassword',         label: 'Merchandise Credit Authentication', desc: 'Require credentials to process merchandise credit',            userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 5678' },
  { enableKey: 'enableRecentSalesAuth',   usernameKey: 'recentSalesAuthUsername',    passwordKey: 'recentSalesAuthPassword',    label: 'Recent Sales Authentication',       desc: 'Require credentials to view history',                         userPlaceholder: 'e.g. supervisor', passPlaceholder: 'e.g. 4321' },
  { enableKey: 'enableCashCountAuth',     usernameKey: 'cashCountAuthUsername',      passwordKey: 'cashCountAuthPassword',      label: 'Cash Count Authentication',         desc: 'Require credentials for end shift',                           userPlaceholder: 'e.g. auditor',    passPlaceholder: 'e.g. 9999' },
  { enableKey: 'enablePriceEditAuth',     usernameKey: 'priceEditAuthUsername',      passwordKey: 'priceEditAuthPassword',      label: 'Edit Price Authentication',         desc: 'Require credentials to edit item price',                      userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableEditItemAuth',      usernameKey: 'editItemAuthUsername',       passwordKey: 'editItemAuthPassword',       label: 'Edit Item Authentication',          desc: 'Require credentials to edit item name',                       userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableEditQtyAuth',       usernameKey: 'editQtyAuthUsername',        passwordKey: 'editQtyAuthPassword',        label: 'Edit Quantity Authentication',      desc: 'Require credentials to edit item quantity',                   userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableSuspendAuth',       usernameKey: 'suspendAuthUsername',        passwordKey: 'suspendAuthPassword',        label: 'Suspend Authentication',            desc: 'Require credentials to suspend (hold) a transaction',          userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableSuspendedAuth',     usernameKey: 'suspendedAuthUsername',      passwordKey: 'suspendedAuthPassword',      label: 'Suspended Authentication',          desc: 'Require credentials to view suspended (held) transactions',    userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableTaxRatesAuth',      usernameKey: 'taxRatesAuthUsername',       passwordKey: 'taxRatesAuthPassword',       label: 'Tax Rates Authentication',          desc: 'Require credentials to manage tax rates',                     userPlaceholder: 'e.g. admin',      passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableOverallReadingAuth',usernameKey: 'overallReadingAuthUsername', passwordKey: 'overallReadingAuthPassword', label: 'Overall Reading Authentication',     desc: 'Require credentials to view overall terminal reading',         userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 1234' },
  { enableKey: 'enableCashTransferAuth',  usernameKey: 'cashTransferAuthUsername',   passwordKey: 'cashTransferAuthPassword',   label: 'Cash Transfer Authentication',       desc: 'Require credentials to process cash deposit or pickup',        userPlaceholder: 'e.g. manager',    passPlaceholder: 'e.g. 1234' },
];

interface Props { settings: PosSettings; set: SetFn; }

function AuthSection({ cfg, settings, set, first }: { cfg: AuthConfig; settings: PosSettings; set: SetFn; first: boolean }) {
  const enabled = !!settings[cfg.enableKey];
  return (
    <div className={`space-y-4${first ? '' : ' border-t pt-4'}`}>
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor={cfg.enableKey as string}>{cfg.label}</Label>
          <p className="text-sm text-muted-foreground">{cfg.desc}</p>
        </div>
        <Switch id={cfg.enableKey as string} checked={enabled} onCheckedChange={v => set(cfg.enableKey, v as any)} />
      </div>
      {enabled && (
        <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-muted">
          <div className="space-y-2">
            <Label htmlFor={`${cfg.usernameKey}`}>Username</Label>
            <Input id={`${cfg.usernameKey}`} value={(settings[cfg.usernameKey] as string) || ''} onChange={e => set(cfg.usernameKey, e.target.value as any)} placeholder={cfg.userPlaceholder} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${cfg.passwordKey}`}>Password</Label>
            <Input id={`${cfg.passwordKey}`} type="password" value={(settings[cfg.passwordKey] as string) || ''} onChange={e => set(cfg.passwordKey, e.target.value as any)} placeholder={cfg.passPlaceholder} />
          </div>
        </div>
      )}
    </div>
  );
}

export function SecuritySettingsCard({ settings, set }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />Security Settings</CardTitle>
        <CardDescription>Manage authentication for sensitive actions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {AUTH_CONFIGS.map((cfg, i) => (
          <AuthSection key={cfg.enableKey as string} cfg={cfg} settings={settings} set={set} first={i === 0} />
        ))}
      </CardContent>
    </Card>
  );
}
