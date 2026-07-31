'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Globe, ShieldCheck, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Building2 } from 'lucide-react';
import type { ApiForm } from './use-external-api';
import type { ExternalApi, AllowedMethods, ApiRole, ApiProvider } from './external-api-types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingApi: ExternalApi | null;
  form: ApiForm;
  setForm: React.Dispatch<React.SetStateAction<ApiForm>>;
  isSaving: boolean;
  onSave: () => void;
}

export function ApiFormDialog({ open, onOpenChange, editingApi, form, setForm, isSaving, onSave }: Props) {
  const set = <K extends keyof ApiForm>(key: K, value: ApiForm[K]) => setForm(f => ({ ...f, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingApi ? 'Edit API' : 'Add New API'}</DialogTitle>
          <DialogDescription>
            {editingApi ? `Update the configuration for "${editingApi.name}".` : 'Configure a new external API connection.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="api-name">Name <span className="text-destructive">*</span></Label>
              <Input id="api-name" placeholder="e.g., Accounting System" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={v => set('provider', v as ApiProvider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="generic">
                    <div className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" />Generic API</div>
                  </SelectItem>
                  <SelectItem value="sta_lucia">
                    <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />Sta. Lucia Tenant System</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Allowed Methods <span className="text-destructive">*</span></Label>
            <Select value={form.allowedMethods} onValueChange={v => set('allowedMethods', v as AllowedMethods)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="send_only"><div className="flex items-center gap-2"><ArrowUp className="h-4 w-4 text-blue-500" />Send Only (POST) — push data to this API</div></SelectItem>
                <SelectItem value="receive_only"><div className="flex items-center gap-2"><ArrowDown className="h-4 w-4 text-purple-500" />Receive Only (GET) — pull data from this API</div></SelectItem>
                <SelectItem value="full_access"><div className="flex items-center gap-2"><ArrowUpDown className="h-4 w-4 text-emerald-500" />Full Access (GET + POST + PUT)</div></SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-desc">Description (Optional)</Label>
            <Textarea id="api-desc" placeholder="What is this API used for?" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-endpoint">
              {form.provider === 'sta_lucia' ? 'Domain' : 'API Endpoint URL'} <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Globe className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="api-endpoint" className="pl-9"
                placeholder={form.provider === 'sta_lucia' ? 'https://sta-lucia-malls.com' : 'https://api.example.com'}
                value={form.apiEndpoint} onChange={e => set('apiEndpoint', e.target.value)}
              />
            </div>
            {form.provider === 'sta_lucia' && (
              <p className="text-xs text-muted-foreground">
                Base domain only — <code>/api/login</code> and <code>/api/get-sales</code> are appended automatically.
              </p>
            )}
          </div>

          {form.provider === 'generic' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Authentication Type</Label>
                <Select value={form.authType} onValueChange={v => set('authType', v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="api_key">API Key (X-API-Key)</SelectItem>
                    <SelectItem value="bearer_token">Bearer Token</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.authType === 'api_key' && (
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key</Label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input id="api-key" type="password" className="pl-9" placeholder="Enter API key" value={form.apiKey} onChange={e => set('apiKey', e.target.value)} />
                  </div>
                </div>
              )}
              {form.authType === 'bearer_token' && (
                <div className="space-y-2">
                  <Label htmlFor="bearer-token">Bearer Token</Label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input id="bearer-token" type="password" className="pl-9" placeholder="Enter bearer token" value={form.bearerToken} onChange={e => set('bearerToken', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {form.provider === 'sta_lucia' && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="space-y-1">
                <Label className="text-base">Sta. Lucia Tenant Account</Label>
                <p className="text-sm text-muted-foreground">
                  Credentials issued by the Sta. Lucia mall for the Tenant Management System —
                  <span className="font-medium text-foreground"> not your Verdix login.</span>
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tenant-email">Tenant Email <span className="text-destructive">*</span></Label>
                  <Input
                    id="tenant-email" type="email" placeholder="tenant@example.com"
                    value={form.loginEmail ?? ''} onChange={e => set('loginEmail', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-password">Tenant Password <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="tenant-password" type="password" className="pl-9" placeholder="Enter tenant password"
                      value={form.loginPassword ?? ''} onChange={e => set('loginPassword', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Sync Mode</Label>
              <Select value={form.syncMode} onValueChange={v => set('syncMode', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="realtime">Real-time</SelectItem>
                  <SelectItem value="batch">Batch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>On Error Action</Label>
              <Select value={form.onErrorAction} onValueChange={v => set('onErrorAction', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="log_only">Log Error Only</SelectItem>
                  <SelectItem value="retry">Automatic Retry</SelectItem>
                  <SelectItem value="queue">Queue for Manual Sync</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input id="timeout" type="number" min={1000} step={1000} value={form.timeout} onChange={e => set('timeout', parseInt(e.target.value) || 30000)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="retry-attempts">Retry Attempts</Label>
              <Input id="retry-attempts" type="number" min={0} max={10} value={form.retryAttempts} onChange={e => set('retryAttempts', parseInt(e.target.value) || 0)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retry-delay">Retry Delay (ms)</Label>
              <Input id="retry-delay" type="number" min={500} step={500} value={form.retryDelay} onChange={e => set('retryDelay', parseInt(e.target.value) || 2000)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-base">Enable this API</Label>
              <p className="text-sm text-muted-foreground">Active APIs will be used for sync operations.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={v => set('enabled', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editingApi ? 'Save Changes' : 'Add API'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
