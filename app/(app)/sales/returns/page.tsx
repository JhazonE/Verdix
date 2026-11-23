'use client';

import { useReturnsData } from './use-returns-data';
import { useReturnsTable } from './use-returns-table';
import { ReturnsFilterBar } from './ReturnsFilterBar';
import { ReturnsSummaryCards } from './ReturnsSummaryCards';
import { ReturnsDataSection } from './ReturnsDataSection';

export default function ReturnedSalesPage() {
  const d = useReturnsData();
  const t = useReturnsTable(d.records);

  return (
    <div className="space-y-6">
      <ReturnsFilterBar
        fromDate={d.fromDate}
        setFromDate={d.setFromDate}
        toDate={d.toDate}
        setToDate={d.setToDate}
        sourceFilter={d.sourceFilter}
        setSourceFilter={d.setSourceFilter}
        isLoading={d.isLoading}
        recordCount={d.records.length}
        onShowReport={d.handleShowReport}
        onExportPDF={d.exportToPDF}
      />

      <ReturnsSummaryCards totals={d.totals} />

      <ReturnsDataSection
        table={t.table}
        columns={t.columns}
        isLoading={d.isLoading}
        viewMode={t.viewMode}
        setViewMode={t.setViewMode}
        globalFilter={t.globalFilter}
        setGlobalFilter={t.setGlobalFilter}
        selectedRow={t.selectedRow}
        setSelectedRow={t.setSelectedRow}
      />
    </div>
  );
}
