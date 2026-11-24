'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Palette, RotateCcw, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import {
  applyColorTheme,
  DEFAULT_BRAND_COLOR,
  normalizeBrandColor,
  setColorPreviewActive,
} from '@/lib/color-themes';

/**
 * Store-wide brand colour picker. Any colour picked previews live on this
 * page; Save persists it through /api/app-theme onto the shared pos_settings
 * row, and every page on every terminal follows via
 * components/color-theme-sync.tsx. Leaving without saving restores the saved
 * colour. Light/dark mode is separate and stays per machine.
 */
export function ColorThemeCard() {
  const { toast } = useToast();
  // null = the default palette (nothing saved).
  const [saved, setSaved] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [hexInput, setHexInput] = useState(DEFAULT_BRAND_COLOR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(getApiUrl('/app-theme'), { cache: 'no-store' })
      .then(r => r.json())
      .then(result => {
        if (!result?.success) return;
        const color = normalizeBrandColor(result.color);
        setSaved(color);
        setPicked(color);
        setHexInput(color ?? DEFAULT_BRAND_COLOR);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // While a preview is unsaved, hold off ColorThemeSync (see
  // setColorPreviewActive). Leaving the page restores the saved colour.
  const dirty = picked !== saved;
  useEffect(() => {
    setColorPreviewActive(dirty);
  }, [dirty]);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => () => {
    setColorPreviewActive(false);
    if (dirtyRef.current) applyColorTheme(savedRef.current);
  }, []);

  const showPreview = (color: string | null) => {
    setPicked(color);
    applyColorTheme(color, { cache: false });
  };

  const onPicked = (color: string | null) => {
    setHexInput(color ?? DEFAULT_BRAND_COLOR);
    showPreview(color);
  };

  const onHexTyped = (value: string) => {
    setHexInput(value);
    const color = normalizeBrandColor(value.startsWith('#') ? value : `#${value}`);
    if (color) showPreview(color);
  };

  const persist = async (color: string | null) => {
    setSaving(true);
    try {
      const res = await fetch(getApiUrl('/app-theme'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color }),
      });
      const result = await res.json();
      if (!result?.success) throw new Error(result?.error);
      setSaved(color);
      setPicked(color);
      setHexInput(color ?? DEFAULT_BRAND_COLOR);
      applyColorTheme(color); // cached, so a reload boots straight into it
      toast({
        title: color ? 'Color theme saved' : 'Default colors restored',
        description: 'Applies store-wide. Other terminals switch within a couple of minutes.',
      });
    } catch {
      toast({ title: 'Save failed', description: 'Could not save the color theme.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const shown = picked ?? DEFAULT_BRAND_COLOR;
  const hexInvalid = !normalizeBrandColor(hexInput.startsWith('#') ? hexInput : `#${hexInput}`);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Color Theme
        </CardTitle>
        <CardDescription>
          Pick one brand colour. Buttons, highlights, the sidebar and page backgrounds are all
          derived from it, for the whole system: back office, POS, customer display and every
          terminal on this database. Light/Dark mode is still chosen per machine in Settings →
          Appearance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-4">
          <label
            className="relative h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 border-border shadow-sm"
            style={{ background: shown }}
            title="Pick a colour"
          >
            <input
              type="color"
              value={shown}
              disabled={loading || saving}
              onChange={e => onPicked(normalizeBrandColor(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Brand colour"
            />
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="brand-hex" className="text-xs font-semibold">Hex</Label>
            <Input
              id="brand-hex"
              value={hexInput}
              disabled={loading || saving}
              onChange={e => onHexTyped(e.target.value.trim())}
              maxLength={7}
              className={`h-9 w-32 font-mono uppercase ${hexInvalid ? 'border-destructive' : ''}`}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => persist(picked)} disabled={loading || saving || !dirty}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() => persist(null)}
              disabled={loading || saving || (saved === null && picked === null)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to default
            </Button>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {loading
            ? 'Loading…'
            : dirty
              ? 'Previewing. Save to apply to every terminal, or leave this page to discard.'
              : saved
                ? `Saved: ${saved.toUpperCase()}`
                : 'Using the default colors.'}
        </p>
      </CardContent>
    </Card>
  );
}
