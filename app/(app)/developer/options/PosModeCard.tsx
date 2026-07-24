'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FlaskConical, Store, Hash, RotateCcw, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';

type PosMode = 'default' | 'pharmacy';

/**
 * POS Mode (Default / Pharmacy) plus the Pharmacy-only Queue Number settings.
 * Self-contained: posMode persists through /api/pos-settings, the queue config
 * through /api/pos/queue/config — the same two APIs the old Settings card used.
 * Rendered on the Developer Options page.
 */
export function PosModeCard() {
  const { toast } = useToast();
  const [posMode, setPosMode] = useState<PosMode>('default');
  const [savingMode, setSavingMode] = useState(false);

  const [queueConfig, setQueueConfig] = useState({ currentNumber: 0, maxNumber: 999, autoResetDaily: true });
  const [maxInput, setMaxInput] = useState('999');
  const [isSavingQueue, setIsSavingQueue] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Load the current POS mode.
  useEffect(() => {
    fetch(getApiUrl('/pos-settings'))
      .then(r => r.json())
      .then(result => {
        if (result.success && result.data?.posMode) setPosMode(result.data.posMode);
      })
      .catch(() => {});
  }, []);

  // Load the queue config.
  useEffect(() => {
    fetch(getApiUrl('/pos/queue/config'))
      .then(r => r.json())
      .then(result => {
        if (result.success) {
          setQueueConfig(result.data);
          setMaxInput(String(result.data.maxNumber));
        }
      })
      .catch(() => {});
  }, []);

  const handleSelectMode = async (mode: PosMode) => {
    if (mode === posMode) return;
    const previous = posMode;
    setPosMode(mode); // optimistic
    setSavingMode(true);
    try {
      const res = await fetch(getApiUrl('/pos-settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posMode: mode }),
      });
      const result = await res.json();
      if (!result.success) throw new Error();
      toast({ title: 'POS Mode updated', description: mode === 'pharmacy' ? 'Pharmacy mode enabled.' : 'Default retail mode enabled.' });
    } catch {
      setPosMode(previous); // revert on failure
      toast({ title: 'Update failed', description: 'Could not change POS mode.', variant: 'destructive' });
    } finally {
      setSavingMode(false);
    }
  };

  const handleSaveQueue = async () => {
    setIsSavingQueue(true);
    try {
      const res = await fetch(getApiUrl('/pos/queue/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxNumber: parseInt(maxInput) || 999, autoResetDaily: queueConfig.autoResetDaily }),
      });
      const result = await res.json();
      if (result.success) toast({ title: 'Queue settings saved' });
    } catch {}
    setIsSavingQueue(false);
  };

  const handleResetQueue = async () => {
    if (!confirm('Reset queue number back to 001?')) return;
    setIsResetting(true);
    try {
      const res = await fetch(getApiUrl('/pos/queue/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      const result = await res.json();
      if (result.success) {
        toast({ title: 'Queue Reset', description: 'Next order will start from 001.' });
        setQueueConfig(c => ({ ...c, currentNumber: 0 }));
      }
    } catch {}
    setIsResetting(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />POS Mode</CardTitle>
        <CardDescription>
          Choose the operating mode for the Point of Sale terminal. Pharmacy mode enables frontliner queue workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={savingMode}
            onClick={() => handleSelectMode('default')}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-colors disabled:opacity-60 ${
              posMode === 'default'
                ? 'border-primary bg-primary/5'
                : 'border-border bg-background hover:border-muted-foreground/40'
            }`}
          >
            <Store className={`h-6 w-6 ${posMode === 'default' ? 'text-primary' : 'text-muted-foreground'}`} />
            <span className="text-sm font-semibold">Default</span>
            <span className="text-xs text-muted-foreground">Standard retail POS</span>
          </button>
          <button
            type="button"
            disabled={savingMode}
            onClick={() => handleSelectMode('pharmacy')}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-colors disabled:opacity-60 ${
              posMode === 'pharmacy'
                ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/20'
                : 'border-border bg-background hover:border-muted-foreground/40'
            }`}
          >
            <FlaskConical className={`h-6 w-6 ${posMode === 'pharmacy' ? 'text-cyan-600' : 'text-muted-foreground'}`} />
            <span className="text-sm font-semibold">Pharmacy</span>
            <span className="text-xs text-muted-foreground">Frontliner queue enabled</span>
          </button>
        </div>

        {/* Queue Number Settings — shown only when Pharmacy mode */}
        {posMode === 'pharmacy' && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-violet-600" />
              <Label className="text-sm font-semibold">Queue Number Settings</Label>
            </div>

            <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current Number</span>
                <span className="font-black text-violet-600 text-lg tabular-nums">
                  {String(queueConfig.currentNumber).padStart(3, '0')}
                </span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="q-max-dev" className="text-xs font-semibold">Max Queue Number</Label>
                <p className="text-xs text-muted-foreground">Resets back to 001 after reaching this number.</p>
                <Input
                  id="q-max-dev"
                  type="number"
                  min={1}
                  max={9999}
                  value={maxInput}
                  onChange={e => setMaxInput(e.target.value)}
                  className="h-9 w-32"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-xs font-semibold">Auto-Reset Daily</Label>
                  <p className="text-xs text-muted-foreground">Reset to 001 every start of day.</p>
                </div>
                <Switch
                  checked={!!queueConfig.autoResetDaily}
                  onCheckedChange={v => setQueueConfig(c => ({ ...c, autoResetDaily: v }))}
                />
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveQueue} disabled={isSavingQueue} className="flex-1">
                  {isSavingQueue && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={handleResetQueue} disabled={isResetting} className="gap-1.5">
                  {isResetting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCcw className="h-3.5 w-3.5" />
                  }
                  Reset Now
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
