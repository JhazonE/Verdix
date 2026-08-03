'use client';

import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { AdminAuthDialog } from '../admin-auth/AdminAuthDialog';
import { XReadingReportView } from './XReadingReportView';
import { useXReading } from './use-x-reading';

export default function XReadingPage() {
  const {
    isAuthDialogOpen, setIsAuthDialogOpen,
    showReport, xReadingData, businessSettings, loading,
    handleAdminAuthSuccess,
    loadXReadingData,
    handlePrint,
  } = useXReading();

  if (!showReport) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <AdminAuthDialog
          isOpen={isAuthDialogOpen}
          onOpenChange={setIsAuthDialogOpen}
          onSuccess={handleAdminAuthSuccess}
        />
      </div>
    );
  }

  return (
    <>
      {loading ? (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex items-center space-x-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Loading X-Reading data...</span>
          </div>
        </div>
      ) : xReadingData ? (
        <XReadingReportView data={xReadingData} businessSettings={businessSettings} onPrint={handlePrint} />
      ) : (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-semibold">No Active Cashier Shift</h2>
            <p className="text-muted-foreground">There is currently no active cashier shift to generate an X-Reading report for.</p>
            <Button onClick={loadXReadingData}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>
      )}
      <Dialog open={isAuthDialogOpen} onOpenChange={setIsAuthDialogOpen}>
        <AdminAuthDialog
          isOpen={isAuthDialogOpen}
          onOpenChange={setIsAuthDialogOpen}
          onSuccess={handleAdminAuthSuccess}
        />
      </Dialog>
    </>
  );
}
