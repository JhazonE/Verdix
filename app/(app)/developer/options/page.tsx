'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl } from '@/lib/api-config';
import { TOGGLEABLE_PAGES } from '@/lib/page-registry';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Save, ShieldAlert } from 'lucide-react';

export default function DeveloperOptionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [authorized, setAuthorized] = useState(false);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Super-admin gate.
  useEffect(() => {
    try {
      const session = JSON.parse(localStorage.getItem('mock-user-session') || '{}');
      if (session?.permissions?.includes('super_admin')) {
        setAuthorized(true);
      } else {
        router.replace('/dashboard');
      }
    } catch {
      router.replace('/dashboard');
    }
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    fetch(getApiUrl('/developer/disabled-pages'))
      .then(res => res.json())
      .then(result => {
        if (result.success) setDisabled(new Set(result.disabled));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authorized]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof TOGGLEABLE_PAGES>();
    for (const p of TOGGLEABLE_PAGES) {
      const list = map.get(p.section) ?? [];
      list.push(p);
      map.set(p.section, list);
    }
    return [...map.entries()];
  }, []);

  const toggle = (key: string, enabled: boolean) => {
    setDisabled(prev => {
      const next = new Set(prev);
      if (enabled) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(getApiUrl('/developer/disabled-pages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: [...disabled] }),
      });
      const body = await res.json();
      if (!body.success) throw new Error();
      toast({ title: 'Saved', description: 'Page visibility updated. Reload to apply everywhere.' });
    } catch {
      toast({ title: 'Save failed', description: 'Could not update page visibility.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!authorized) return null;

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" />
            Developer Options
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Enable or disable pages. Disabled pages are hidden from the sidebar and their URLs redirect to the dashboard.
          </p>
        </div>
        <Button onClick={save} disabled={saving || loading}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {grouped.map(([section, pages]) => (
          <Card key={section}>
            <CardHeader>
              <CardTitle>{section}</CardTitle>
              <CardDescription>{pages.length} pages</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pages.map(p => {
                const enabled = !disabled.has(p.key);
                return (
                  <div key={p.key} className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{p.label}</span>
                      <span className="text-xs text-muted-foreground font-mono">{p.href}</span>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => toggle(p.key, v)}
                      aria-label={p.label}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
