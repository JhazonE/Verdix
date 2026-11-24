'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, ShieldCheck, Database } from 'lucide-react';

// localStorage keys that hold operational state / setup — these must NEVER be
// cleared by a "safe refresh" or the user would be logged out or lose their
// in-progress cart, active shift, terminal binding and printer configuration.
const PRESERVED_KEYS = [
  'mock-user-session',
  'pos_current_user',
  'pos_current_cart',
  'pos_current_shift_id',
  'pos_terminal_id',
  'server_ip',
  'pos_printer_mode',
  'pos_printer_name',
  'pos_paper_size',
  'pos_print_two_receipts',
  'pos-theme',
  'admin-theme',
  'color-theme',
];

export default function CacheSettingsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [clearing, setClearing] = useState(false);

  const handleSafeRefresh = async () => {
    setClearing(true);
    try {
      // 1) Clear the React Query in-memory cache so all data is re-fetched
      //    fresh from the MySQL database on the next load.
      queryClient.clear();

      // 2) Clear only the non-essential localStorage keys, preserving the
      //    session, cart, shift, terminal and printer setup.
      try {
        const keys = Object.keys(window.localStorage);
        for (const key of keys) {
          if (!PRESERVED_KEYS.includes(key)) {
            window.localStorage.removeItem(key);
          }
        }
      } catch {
        // localStorage may be unavailable in some contexts — ignore.
      }

      // 3) Clear the Electron/Chromium HTTP & asset cache (desktop app only).
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.clearCache) {
        const result = await electronAPI.clearCache();
        if (result && result.success === false) {
          throw new Error(result.error || 'Failed to clear application cache.');
        }
      }

      toast({
        title: 'Cache cleared',
        description:
          'Fresh data will load from the database. Your login, cart, shift and printer setup were kept.',
      });

      // 4) Reload so every screen re-fetches against a clean cache.
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Could not clear cache',
        description: err?.message || 'An unexpected error occurred.',
      });
      setClearing(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Cache &amp; Refresh</h2>
      </div>

      <div className="grid gap-4 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Clear Cache (Safe Refresh)
            </CardTitle>
            <CardDescription>
              Forces the app to reload all data fresh from the database. Use this
              if a screen is showing outdated products, prices, inventory or sales.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm dark:border-green-900/50 dark:bg-green-950/30">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                <div className="space-y-1">
                  <p className="font-medium text-green-800 dark:text-green-300">
                    Your data is safe
                  </p>
                  <p className="text-green-700 dark:text-green-400">
                    This only clears the temporary cache. It does <strong>not</strong>{' '}
                    delete anything from the database — products, sales, inventory
                    and reports stay intact. Your login, open cart, active shift,
                    terminal and printer settings are also kept.
                  </p>
                </div>
              </div>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground flex items-center gap-2">
                <Database className="h-4 w-4" /> What gets cleared:
              </p>
              <ul className="list-disc pl-6 space-y-0.5">
                <li>Cached data fetches (re-loaded from the database)</li>
                <li>Cached app files &amp; images (Chromium HTTP cache)</li>
                <li>Temporary UI / version markers</li>
              </ul>
            </div>

            <Button onClick={handleSafeRefresh} disabled={clearing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${clearing ? 'animate-spin' : ''}`} />
              {clearing ? 'Clearing…' : 'Clear Cache & Refresh'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
