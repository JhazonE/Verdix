'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, Pencil, Send, Trash2, ArrowUp, ArrowDown, ArrowUpDown, Upload } from 'lucide-react';
import { METHODS_BADGE, type ExternalApi } from './external-api-types';

interface Props {
  api: ExternalApi;
  testingId: string | null;
  sendingId: string | null;
  onToggle: (api: ExternalApi) => void;
  onEdit: (api: ExternalApi) => void;
  onDelete: (api: ExternalApi) => void;
  onTest: (api: ExternalApi) => void;
  onSendZReading: (api: ExternalApi) => void;
}

export function ApiCard({ api, testingId, sendingId, onToggle, onEdit, onDelete, onTest, onSendZReading }: Props) {
  const methods = METHODS_BADGE[api.allowedMethods];
  return (
    <Card className={!api.enabled ? 'opacity-60' : ''}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="pt-0.5">
            <Switch checked={api.enabled} onCheckedChange={() => onToggle(api)} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-base">{api.name}</span>
              <Badge variant="outline" className={methods.class}>
                {api.allowedMethods === 'send_only'    && <ArrowUp    className="mr-1 h-3 w-3" />}
                {api.allowedMethods === 'receive_only' && <ArrowDown   className="mr-1 h-3 w-3" />}
                {api.allowedMethods === 'full_access'  && <ArrowUpDown className="mr-1 h-3 w-3" />}
                {methods.label}
              </Badge>
              <Badge variant={api.enabled ? 'default' : 'secondary'}>
                {api.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              {api.provider === 'sta_lucia' && (
                <Badge variant="outline" className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                  Sta. Lucia
                </Badge>
              )}
            </div>

            <p className="text-sm text-muted-foreground font-mono truncate mb-1">{api.apiEndpoint}</p>
            {api.description && <p className="text-sm text-muted-foreground">{api.description}</p>}

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              <span>Auth: <span className="font-medium capitalize">{api.authType.replace('_', ' ')}</span></span>
              <span>Sync: <span className="font-medium capitalize">{api.syncMode}</span></span>
              <span>On Error: <span className="font-medium">{api.onErrorAction.replace('_', ' ')}</span></span>
              <span>Timeout: <span className="font-medium">{(api.timeout / 1000).toFixed(0)}s</span></span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {api.provider === 'sta_lucia' && (
              // Disabled while the card is off: the send path refuses disabled
              // configs server-side, so an enabled-looking button would only
              // ever produce "No enabled Sta Lucia API is configured".
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSendZReading(api)}
                disabled={!api.enabled || sendingId === api.id}
                title={!api.enabled ? 'Enable this integration to submit Z-readings' : undefined}
              >
                {sendingId === api.id
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                Send Z-Reading
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onTest(api)} disabled={testingId === api.id}>
              {testingId === api.id
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Test
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onEdit(api)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => onDelete(api)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
