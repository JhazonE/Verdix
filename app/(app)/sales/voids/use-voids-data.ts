'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { getApiUrl } from '@/lib/api-config';
import jsPDF from 'jspdf';
import type { VoidRecord } from './voids-types';
import { SALES_SOURCE_OPTIONS, type SalesSourceFilter } from '@/lib/sales-source';

export function useVoidsData() {
  const { toast } = useToast();
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [queryDates, setQueryDates] = useState({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  // Applies immediately, like the toggle on the other sales reports.
  const [sourceFilter, setSourceFilter] = useState<SalesSourceFilter>('all');

  const { data: records = [], isLoading, isError, error } = useQuery<VoidRecord[]>({
    queryKey: ['voids', queryDates.from?.toISOString(), queryDates.to?.toISOString(), sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (queryDates.from) params.append('startDate', format(queryDates.from, 'yyyy-MM-dd'));
      if (queryDates.to) params.append('endDate', format(queryDates.to, 'yyyy-MM-dd'));
      if (sourceFilter !== 'all') params.append('source', sourceFilter);
      const response = await fetch(getApiUrl(`/sales/voids-report?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) return result.data;
      throw new Error(result.error || 'Failed to load voided sales.');
    },
    retry: 1,
    placeholderData: (prev) => prev,
  });

  const totals = useMemo(
    () => ({
      revenue: records.reduce((sum, r) => sum + r.salesAmount, 0),
      cost: records.reduce((sum, r) => sum + r.cost, 0),
      profit: records.reduce((sum, r) => sum + r.profit, 0),
      vatableSales: records.reduce((sum, r) => sum + r.vatableSales, 0),
      vatAmount: records.reduce((sum, r) => sum + r.vatAmount, 0),
    }),
    [records]
  );

  const handleShowReport = () => {
    if (fromDate && toDate) setQueryDates({ from: fromDate, to: toDate });
  };

  const exportToPDF = (totalsSnapshot: typeof totals) => {
    if (records.length === 0) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }

    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 10;
      let yPos = margin;

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Voided Sales Report', pageWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `From: ${queryDates.from ? format(queryDates.from, 'yyyy-MM-dd') : 'N/A'} To: ${queryDates.to ? format(queryDates.to, 'yyyy-MM-dd') : 'N/A'}   Source: ${SALES_SOURCE_OPTIONS.find((o) => o.value === sourceFilter)?.label ?? 'All'}`,
        pageWidth / 2, yPos, { align: 'center' }
      );
      yPos += 10;

      const headers = ['RefNo.', 'Trans Date', 'Customer', 'Cashier', 'Void Date', 'Voided By', 'Override By', 'Sales Amt', 'Cost', 'Profit', 'Vatable', 'VAT', 'Note'];
      const colWidths = [22, 22, 25, 18, 22, 18, 18, 18, 16, 16, 18, 14, 30];

      const drawHeader = () => {
        doc.setFillColor(220, 53, 69);
        doc.rect(margin, yPos - 4, pageWidth - margin * 2, 8, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        let xPos = margin;
        headers.forEach((header, i) => {
          doc.text(header, xPos + 1, yPos, { maxWidth: colWidths[i] - 2 });
          xPos += colWidths[i];
        });
        yPos += 6;
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
      };

      drawHeader();

      records.forEach((record, rowIndex) => {
        if (yPos > pageHeight - 20) {
          doc.addPage();
          yPos = margin;
          drawHeader();
        }

        if (rowIndex % 2 === 0) {
          doc.setFillColor(245, 245, 245);
          doc.rect(margin, yPos - 3, pageWidth - margin * 2, 6, 'F');
        }

        let xPos = margin;
        const rowData = [
          record.refNo,
          record.transDate ? format(new Date(record.transDate), 'MMM dd, yyyy') : '-',
          record.customer,
          record.cashier,
          record.voidDate ? format(new Date(record.voidDate), 'MMM dd, yyyy hh:mma') : '-',
          record.voidedBy,
          record.overrideBy,
          record.salesAmount.toFixed(2),
          record.cost.toFixed(2),
          record.profit.toFixed(2),
          record.vatableSales.toFixed(2),
          record.vatAmount.toFixed(2),
          record.note || '',
        ];

        rowData.forEach((cell, i) => {
          doc.text(String(cell), xPos + 1, yPos, { maxWidth: colWidths[i] - 2 });
          xPos += colWidths[i];
        });
        yPos += 6;
      });

      yPos += 4;
      doc.setFillColor(200, 200, 200);
      doc.rect(margin, yPos - 4, pageWidth - margin * 2, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      let xPos = margin;
      colWidths.forEach((width, i) => {
        if (i === 0) doc.text('TOTALS', xPos + 1, yPos);
        else if (i === 7) doc.text(totalsSnapshot.revenue.toFixed(2), xPos + 1, yPos);
        else if (i === 8) doc.text(totalsSnapshot.cost.toFixed(2), xPos + 1, yPos);
        else if (i === 9) doc.text(totalsSnapshot.profit.toFixed(2), xPos + 1, yPos);
        else if (i === 10) doc.text(totalsSnapshot.vatableSales.toFixed(2), xPos + 1, yPos);
        else if (i === 11) doc.text(totalsSnapshot.vatAmount.toFixed(2), xPos + 1, yPos);
        xPos += width;
      });

      const fileName = `Voided_Sales_Report_${format(queryDates.from || new Date(), 'yyyyMMdd')}_${format(queryDates.to || new Date(), 'yyyyMMdd')}.pdf`;
      doc.save(fileName);
      toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
    } catch (err) {
      console.error('Error exporting PDF:', err);
      toast({ title: 'Export Failed', description: 'Failed to generate PDF.', variant: 'destructive' });
    }
  };

  return {
    fromDate, setFromDate,
    toDate, setToDate,
    queryDates,
    sourceFilter, setSourceFilter,
    records, isLoading, isError, error,
    totals,
    handleShowReport,
    exportToPDF,
  };
}
