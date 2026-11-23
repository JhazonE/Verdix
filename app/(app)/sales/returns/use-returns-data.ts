'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { getApiUrl } from '@/lib/api-config';
import jsPDF from 'jspdf';
import type { ReturnRecord } from './returns-types';
import { SALES_SOURCE_OPTIONS, type SalesSourceFilter } from '@/lib/sales-source';

export function useReturnsData() {
  const { toast } = useToast();
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [queryDates, setQueryDates] = useState({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  // Applies immediately, like the toggle on the other sales reports. Sent as
  // ?source= to /api/sales/transactions, which already parses it.
  const [sourceFilter, setSourceFilter] = useState<SalesSourceFilter>('all');

  const { data: records = [], isLoading } = useQuery<ReturnRecord[]>({
    queryKey: ['returns', queryDates.from?.toISOString(), queryDates.to?.toISOString(), sourceFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (queryDates.from) params.append('startDate', format(queryDates.from, 'yyyy-MM-dd'));
      if (queryDates.to) params.append('endDate', format(queryDates.to, 'yyyy-MM-dd'));
      params.append('status', 'Returned');
      if (sourceFilter !== 'all') params.append('source', sourceFilter);
      const response = await fetch(getApiUrl(`/sales/transactions?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        return result.data
          .filter((tx: any) => tx.transactionType === 'return')
          .map((tx: any) => {
            const origSiNo = tx.originalSINumber ? String(tx.originalSINumber).padStart(6, '0') : (tx.originalOrderNumber ? String(tx.originalOrderNumber).padStart(6, '0') : 'N/A');
            const currSiNo = tx.siNumber ? String(tx.siNumber).padStart(6, '0') : (tx.orderNumber ? String(tx.orderNumber).padStart(6, '0') : 'N/A');
            return {
              mcNo: tx.mcNumber || '',
              origSiNo,
              currSiNo,
              transDate: tx.originalTransactionTime || '',
              soldByCashier: tx.originalCashierName || 'N/A',
              returnedDate: tx.date || '',
              returnedByCashier: tx.cashier || 'N/A',
              overrideBy: tx.customer?.name || 'admin',
              salesAmount: Math.abs(tx.total || 0),
              cost: Math.abs(tx.cost || 0),
              profit: tx.profit || 0,
              vatableSales: Math.abs(tx.vatableSales || 0),
              vatAmount: Math.abs(tx.taxAmount || 0),
              note: tx.notes || '',
            };
          });
      }
      return [];
    },
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

  const exportToPDF = () => {
    if (records.length === 0) {
      toast({ title: 'No Data', description: 'No records to export. Please fetch the report first.', variant: 'destructive' });
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
      doc.text('Merchandise Credit Report', pageWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `From: ${queryDates.from ? format(queryDates.from, 'yyyy-MM-dd') : 'N/A'} To: ${queryDates.to ? format(queryDates.to, 'yyyy-MM-dd') : 'N/A'}   Source: ${SALES_SOURCE_OPTIONS.find((o) => o.value === sourceFilter)?.label ?? 'All'}`,
        pageWidth / 2, yPos, { align: 'center' }
      );
      yPos += 10;

      const headers = ['MC No.', 'Orig SI No.', 'Trans Date', 'Sold By', 'Return Date', 'Returned By', 'Override By', 'Sales Amt', 'Cost', 'Profit', 'Vatable', 'VAT', 'Note'];
      const colWidths = [24, 20, 22, 18, 22, 18, 18, 18, 16, 16, 18, 14, 30];

      const drawHeader = () => {
        doc.setFillColor(34, 197, 94);
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
          record.mcNo || '—',
          record.origSiNo,
          record.transDate ? format(new Date(record.transDate), 'MMM dd, yyyy') : '-',
          record.soldByCashier,
          record.returnedDate ? format(new Date(record.returnedDate), 'MMM dd, yyyy hh:mma') : '-',
          record.returnedByCashier,
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
        else if (i === 7) doc.text(totals.revenue.toFixed(2), xPos + 1, yPos);
        else if (i === 8) doc.text(totals.cost.toFixed(2), xPos + 1, yPos);
        else if (i === 9) doc.text(totals.profit.toFixed(2), xPos + 1, yPos);
        else if (i === 10) doc.text(totals.vatableSales.toFixed(2), xPos + 1, yPos);
        else if (i === 11) doc.text(totals.vatAmount.toFixed(2), xPos + 1, yPos);
        xPos += width;
      });

      const fileName = `Merchandise_Credit_Report_${format(queryDates.from || new Date(), 'yyyyMMdd')}_${format(queryDates.to || new Date(), 'yyyyMMdd')}.pdf`;
      doc.save(fileName);
      toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast({ title: 'Export Failed', description: 'Failed to generate PDF.', variant: 'destructive' });
    }
  };

  return {
    fromDate, setFromDate,
    toDate, setToDate,
    queryDates,
    sourceFilter, setSourceFilter,
    records, isLoading,
    totals,
    handleShowReport,
    exportToPDF,
  };
}
