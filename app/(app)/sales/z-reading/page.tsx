'use client';

import { useZReadingPage } from './use-z-reading-page';
import { ZReadingFilterBar } from './ZReadingFilterBar';
import { ZReadingTable } from './ZReadingTable';
import { ZReadingPreviewModal } from './ZReadingPreviewModal';

export default function ZReadingPage() {
  const p = useZReadingPage();

  return (
    <div className="space-y-6">
      <ZReadingFilterBar
        dateRange={p.dateRange}
        setDateRange={p.setDateRange}
        terminal={p.terminal}
        setTerminal={p.setTerminal}
        table={p.table}
        onShowReport={p.handleShowReport}
      />

      <div className="border-t pt-6">
        <ZReadingTable
          table={p.table}
          columns={p.columns}
          isLoading={p.isLoading}
          hasQuery={!!p.queryParams}
          isError={p.isError}
          errorMessage={p.errorMessage}
          onRetry={() => p.refetch()}
        />
      </div>

      {p.isPreviewOpen && p.selectedReading && (
        <ZReadingPreviewModal
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
