'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Building2, Settings, Lock, ClipboardCheck, FileText, Database } from 'lucide-react';
import { usePosSetup } from './use-pos-setup';
import { BusinessSetupCard } from './BusinessSetupCard';
import { GeneralSettingsCard } from './GeneralSettingsCard';
import { TransactionConfirmationsCard } from './TransactionConfirmationsCard';
import { BatchCostingCard } from './BatchCostingCard';
import { BirComplianceCard } from './BirComplianceCard';
import { SecuritySettingsCard } from './SecuritySettingsCard';
import { TerminalCard } from './TerminalCard';
import { CustomerDisplayCard } from './CustomerDisplayCard';
import { MembershipCard } from './MembershipCard';
import { StartupCard } from './StartupCard';
import { DataManagementGrid } from './DataManagementGrid';

export default function PosSetupPage() {
  const [activeTab, setActiveTab] = useState('business');
  const { settings, set, isLoading, isSaving, isUploading, logoPreview, handleSave, handleLogoUpload, fetchSettings } = usePosSetup();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 pt-6 gap-4 min-h-0">
      <h2 className="text-3xl font-bold tracking-tight shrink-0">POS Setup</h2>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-4 shrink-0 flex-wrap">
          <TabsList className="h-10">
            <TabsTrigger value="business" className="gap-1.5 text-xs">
              <Building2 className="h-3.5 w-3.5" />Business
            </TabsTrigger>
            <TabsTrigger value="general" className="gap-1.5 text-xs">
              <Settings className="h-3.5 w-3.5" />General
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5 text-xs">
              <Lock className="h-3.5 w-3.5" />Security
            </TabsTrigger>
            <TabsTrigger value="confirmations" className="gap-1.5 text-xs">
              <ClipboardCheck className="h-3.5 w-3.5" />Confirmations
            </TabsTrigger>
            <TabsTrigger value="compliance" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" />BIR
            </TabsTrigger>
            <TabsTrigger value="data" className="gap-1.5 text-xs">
              <Database className="h-3.5 w-3.5" />Data
            </TabsTrigger>
          </TabsList>

          {activeTab !== 'data' && (
            <Button onClick={() => handleSave()} disabled={isSaving} size="sm">
              {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Settings'}
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto mt-4 min-h-0 pb-6">
          <TabsContent value="business" className="mt-0 space-y-4">
            <BusinessSetupCard settings={settings} set={set} logoPreview={logoPreview} isUploading={isUploading} onLogoUpload={handleLogoUpload} />
          </TabsContent>

          <TabsContent value="general" className="mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                <GeneralSettingsCard settings={settings} set={set} />
                <TerminalCard currentTerminalId={settings.currentTerminalId} currentTerminalName={settings.currentTerminalName} set={set} />
              </div>
              <div className="space-y-4">
                <CustomerDisplayCard settings={settings} set={set} />
                <MembershipCard settings={settings} set={set} />
                <StartupCard />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="security" className="mt-0">
            <SecuritySettingsCard settings={settings} set={set} />
          </TabsContent>

          <TabsContent value="confirmations" className="mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TransactionConfirmationsCard settings={settings} set={set} />
              <BatchCostingCard settings={settings} set={set} />
            </div>
          </TabsContent>

          <TabsContent value="compliance" className="mt-0">
            <BirComplianceCard settings={settings} set={set} />
          </TabsContent>

          <TabsContent value="data" className="mt-0">
            <DataManagementGrid onRefresh={fetchSettings} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
