'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Loader2, Palette } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import {
  COLOR_THEMES,
  COLOR_THEME_EVENT,
  DEFAULT_COLOR_THEME,
  normalizeColorTheme,
  type ColorThemeId,
} from '@/lib/color-themes';

/**
 * Store-wide colour theme picker. Persists through /api/app-theme onto the
 * shared pos_settings row; every page on every terminal picks it up via
 * components/color-theme-sync.tsx (instantly here, within ~2 minutes or on
 * next focus elsewhere). Light/dark mode is separate and stays per machine
 * under Settings → Appearance.
 */
export function ColorThemeCard() {
  const { toast } = useToast();
  const [current, setCurrent] = useState<ColorThemeId>(DEFAULT_COLOR_THEME);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ColorThemeId | null>(null);

  useEffect(() => {
    fetch(getApiUrl('/app-theme'), { cache: 'no-store' })
      .then(r => r.json())
      .then(result => {
        if (result?.success) setCurrent(normalizeColorTheme(result.theme));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const announce = (id: ColorThemeId) =>
    window.dispatchEvent(new CustomEvent(COLOR_THEME_EVENT, { detail: id }));

  const select = async (id: ColorThemeId) => {
    if (id === current || saving) return;
    const previous = current;
    setCurrent(id);
    announce(id); // preview immediately
    setSaving(id);
    try {
      const res = await fetch(getApiUrl('/app-theme'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: id }),
      });
      const result = await res.json();
      if (!result?.success) throw new Error(result?.error);
      const label = COLOR_THEMES.find(t => t.id === id)?.label ?? id;
      toast({
        title: 'Color theme updated',
        description: `${label} now applies store-wide. Other terminals switch within a couple of minutes.`,
      });
    } catch {
      setCurrent(previous);
      announce(previous);
      toast({ title: 'Update failed', description: 'Could not save the color theme.', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Color Theme
        </CardTitle>
        <CardDescription>
          Sets the accent and surface colours for the whole system — back office, POS, customer
          display and every terminal on this database. Light/Dark mode is still chosen per machine
          in Settings → Appearance; each theme has both.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {COLOR_THEMES.map(theme => {
            const active = theme.id === current;
            return (
              <button
                key={theme.id}
                type="button"
                disabled={loading || saving !== null}
                onClick={() => select(theme.id)}
                aria-pressed={active}
                className={`group flex flex-col overflow-hidden rounded-xl border-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  active ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                {/* Miniature of the app: sidebar strip, page, a primary button. */}
                <div className="flex h-16 w-full" aria-hidden>
                  <div className="w-1/4" style={{ background: `hsl(${theme.preview.sidebar})` }} />
                  <div
                    className="flex flex-1 flex-col justify-between p-2"
                    style={{ background: `hsl(${theme.preview.background})` }}
                  >
                    <div className="h-1.5 w-3/4 rounded-full bg-black/10" />
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-10 rounded" style={{ background: `hsl(${theme.preview.primary})` }} />
                      {active && (
                        <span
                          className="flex h-4 w-4 items-center justify-center rounded-full text-white"
                          style={{ background: `hsl(${theme.preview.primary})` }}
                        >
                          {saving === theme.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-0.5 border-t bg-card p-2">
                  <div className="text-sm font-semibold">{theme.label}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">{theme.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
