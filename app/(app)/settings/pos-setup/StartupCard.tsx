'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Power, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type StartupState = { supported: boolean; enabled: boolean; reason?: string; error?: string };

/**
 * Launch-at-startup toggle.
 *
 * Unlike every other card on this page, this one is NOT part of the shared
 * `settings` object and is not written by "Save Settings". Whether the POS
 * opens at boot is a property of THIS computer, not of the store: a shop runs
 * several terminals and a back-office PC off one database, and only the
 * terminals should autostart. So the state is read from and written to Windows
 * through Electron, and each toggle applies immediately.
 */
export function StartupCard() {
  const { toast } = useToast();
  const [state, setState] = useState<StartupState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    // No bridge at all means a plain web browser, where there is no startup
    // folder to manage. The card still renders, but disabled with a reason —
    // an earlier version returned null here and in dev, which made the whole
    // feature look like it had never been built.
    if (!api?.getStartup) {
      setState({ supported: false, enabled: false });
      return;
    }
    api.getStartup()
      .then((s: StartupState) => setState(s))
      .catch(() => setState({ supported: false, enabled: false }));
  }, []);

  const handleChange = useCallback(async (next: boolean) => {
    const api = (window as any).electronAPI;
    if (!api?.setStartup) return;
    setIsSaving(true);
    try {
      const result: StartupState = await api.setStartup(next);
      // Trust what Windows reports back, not what was asked for: removing the
      // installer's shortcut can fail (e.g. a locked file) and the result then
      // says it is still enabled.
      setState(prev => ({ ...(prev ?? { supported: true }), ...result }));
      if (result.error) {
        toast({ variant: 'destructive', title: 'Could not change startup setting', description: result.error });
      } else {
        toast({
          title: result.enabled ? 'Startup enabled' : 'Startup disabled',
          description: result.enabled
            ? 'This computer will open the POS when Windows starts.'
            : 'This computer will no longer open the POS when Windows starts.',
        });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not change startup setting', description: String(err) });
    } finally {
      setIsSaving(false);
    }
  }, [toast]);

  if (!state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Power className="h-5 w-5" />Startup</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Power className="h-5 w-5" />Startup</CardTitle>
        <CardDescription>Applies to this computer only, not to other terminals</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="launchAtStartup">Open POS When Windows Starts</Label>
            <p className="text-sm text-muted-foreground">Launch the POS automatically after this computer boots and signs in</p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Switch
              id="launchAtStartup"
              checked={state.enabled}
              disabled={isSaving || !state.supported}
              onCheckedChange={handleChange}
            />
          </div>
        </div>
        {!state.supported && (
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
            This setting changes Windows itself, which a web page cannot do. Open
            this page inside the Vendix desktop app on the terminal you want to
            change, and the switch becomes available there.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
