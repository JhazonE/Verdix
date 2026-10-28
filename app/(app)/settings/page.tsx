'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Settings as SettingsIcon, Bell, Users, Database, Key, Palette, Globe, RefreshCw } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <Badge variant="secondary" className="text-sm">
          <SettingsIcon className="mr-1 h-4 w-4" />
          Manage Application
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/system'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Preferences</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Configure core application settings and behaviors
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Currency, timezone, language, etc.
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/notifications'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Notifications</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Manage notification preferences and alerts
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Email alerts, push notifications, reports
            </div>
          </CardContent>
        </Card>


        <Card className="opacity-70">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-sm font-medium">Security</CardTitle>
              <Badge variant="destructive" className="w-fit text-[10px] px-2 py-0 h-4">Feature Unavailable</Badge>
            </div>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Configure security settings and policies
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Password policies, 2FA, session timeouts
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/appearance'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Appearance</CardTitle>
            <Palette className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Customize the application's look and feel
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Themes, colors, layout preferences
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/data-management'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Management</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Handle data export, backup, and maintenance
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Backups, exports, data cleanup tools
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/pos-setup'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">POS Setup</CardTitle>
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Configure POS system settings and preferences
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Business info, terminals, payment terms, sales setup
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/pricing'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pricing Configuration</CardTitle>
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Configure markup rules and priorities
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Auto-markup, default percentages, priority
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/cache'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache &amp; Refresh</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Clear cached data and reload fresh from the database
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Safe refresh — does not delete any data
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={() => window.location.href = '/settings/external-api'}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">External API Integration</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-4">
              Sync data with external accounting systems
            </CardDescription>
            <div className="text-xs text-muted-foreground">
              Configure endpoints, sync logs, and monitoring
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

