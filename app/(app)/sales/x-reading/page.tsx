'use client';

import { useXReadingPage } from './use-x-reading-page';
import { XReadingFilterBar } from './XReadingFilterBar';
import { XReadingTable } from './XReadingTable';
import { XReadingPreviewModal } from './XReadingPreviewModal';

export default function XReadingPage() {
  const p = useXReadingPage();

  return (
    <div className="space-y-6">
      <XReadingFilterBar
        dateRange={p.dateRange}
        setDateRange={p.setDateRange}
        selectedCashier={p.selectedCashier}
        setSelectedCashier={p.setSelectedCashier}
        uniqueCashiers={p.uniqueCashiers}
        xReadingsCount={p.xReadings.length}
        onShowReport={p.handleShowReport}
      />

      <div className="border-t pt-6">
        <XReadingTable
          table={p.table}
          columns={p.columns}
          isLoading={p.isLoading}
          selectedCashier={p.selectedCashier}
          hasQuery={!!p.queryParams}
          isError={p.isError}
          errorMessage={p.errorMessage}
          onRetry={() => p.refetch()}
        />
      </div>

      {p.isPreviewOpen && p.selectedReading && (
        <XReadingPreviewModal
          isOpen={p.isPreviewOpen}
          onClose={() => p.setIsPreviewOpen(false)}
          selectedReading={p.selectedReading}
          printerFormat={p.printerFormat}
          setPrinterFormat={p.setPrinterFormat}
          businessSettings={p.businessSettings}
          previewRef={p.previewRef}
          onPrint={p.handleReactToPrintFn}
        />
      )}
    </div>
  );
}
