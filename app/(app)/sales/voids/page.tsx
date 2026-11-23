'use client';

import { useVoidsData } from './use-voids-data';
import { useVoidsTable } from './use-voids-table';
import { VoidsFilterBar } from './VoidsFilterBar';
import { VoidsSummaryCards } from './VoidsSummaryCards';
import { VoidsDataSection } from './VoidsDataSection';

export default function VoidedSalesPage() {
  const d = useVoidsData();
  const t = useVoidsTable(d.records);

  return (
    <div className="space-y-6">
      <VoidsFilterBar
        fromDate={d.fromDate}
        setFromDate={d.setFromDate}
        toDate={d.toDate}
        setToDate={d.setToDate}
        sourceFilter={d.sourceFilter}
        setSourceFilter={d.setSourceFilter}
        isLoading={d.isLoading}
        recordCount={d.records.length}
        onShowReport={d.handleShowReport}
        onExportPDF={() => d.exportToPDF(d.totals)}
      />

      <VoidsSummaryCards totals={d.totals} />

      <VoidsDataSection
        table={t.table}
        columns={t.columns}
        isLoading={d.isLoading}
        isError={d.isError}
        error={d.error as Error | null}
        viewMode={t.viewMode}
        setViewMode={t.setViewMode}
        globalFilter={t.globalFilter}
        setGlobalFilter={t.setGlobalFilter}
        selectedRow={t.selectedRow}
        setSelectedRow={t.setSelectedRow}
        selectedIds={t.selectedIds}
      />
    </div>
  );
}
