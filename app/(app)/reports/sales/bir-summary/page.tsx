'use client';

import { useState, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { Button } from '@/components/ui/button';
import { CalendarIcon, FileDown, Landmark, FileText, FileSpreadsheet } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { getApiUrl } from '@/lib/api-config';
import jsPDF from 'jspdf';

interface DailySummary {
  date: string;
  beginningSI: string;
  endingSI: string;
  beginningOR: string;
  endingOR: string;
  grandAccumulatedBeginning: number;
  manualSiOr: number;
  grossSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExempt: number;
  zeroRated: number;
  discSenior: number;
  discPwd: number;
  discNaac: number;
  discSolo: number;
  discOther: number;
  returns: number;
  voids: number;
  totalDeductions: number;
  vatAdjSenior: number;
  vatAdjPwd: number;
  vatAdjOther: number;
  vatOnReturns: number;
  vatAdjOthers: number;
  totalVatAdjustment: number;
  vatPayable: number;
  netSales: number;
  salesOverrun: number;
  totalIncome: number;
  resetCounter: number;
  zCounter: number;
  remarks: string;
}

interface BookRecord {
  date: string;
  holderName: string;
  idNumber: string;
  tin: string | null;
  siOrNumber: string;
  salesInclusiveVat: number;
  vatAmount: number;
  vatExemptSales: number;
  discountPercentage: number;
  discountAmount: number;
  netSales: number;
}

interface BirData {
  dailySummary: DailySummary[];
  seniorBook: BookRecord[];
  pwdBook: BookRecord[];
  naacBook: BookRecord[];
  soloParentBook: BookRecord[];
}

const EMPTY: BirData = {
  dailySummary: [],
  seniorBook: [],
  pwdBook: [],
  naacBook: [],
  soloParentBook: [],
};

const peso = (v: number) =>
  `₱${v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n2 = (v: number) => v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BirSalesSummaryPage() {
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
  const [data, setData] = useState<BirData>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'senior' | 'pwd' | 'naac' | 'solo'>('summary');
  const { toast } = useToast();

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('startDate', format(fromDate, 'yyyy-MM-dd'));
      if (toDate) params.append('endDate', format(toDate, 'yyyy-MM-dd'));
      const response = await fetch(getApiUrl(`/sales/bir-summary?${params.toString()}`));
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const result = await response.json();
      if (result.success) {
        setData(result.data || EMPTY);
      } else {
        throw new Error(result.error || 'Failed');
      }
    } catch (error) {
      console.error('Error fetching BIR sales summary:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch BIR sales summary. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const summaryTotals = data.dailySummary.reduce(
    (acc, r) => ({
      grossSales: acc.grossSales + r.grossSales,
      totalDeductions: acc.totalDeductions + r.totalDeductions,
      vatPayable: acc.vatPayable + r.vatPayable,
      netSales: acc.netSales + r.netSales,
    }),
    { grossSales: 0, totalDeductions: 0, vatPayable: 0, netSales: 0 }
  );

  type TabKey = 'summary' | 'senior' | 'pwd' | 'naac' | 'solo';

  const SECTION_LABELS: Record<TabKey, string> = {
    summary: 'Daily Sales Summary',
    senior: 'Senior Citizen Sales Book',
    pwd: 'Person With Disability (PWD) Sales Book',
    naac: 'National Athletes & Coaches Sales Book',
    solo: 'Solo Parent Sales Book',
  };
  const FILE_LABELS: Record<TabKey, string> = {
    summary: 'BIR_Daily_Sales_Summary',
    senior: 'Senior_Citizen_Sales_Book',
    pwd: 'PWD_Sales_Book',
    naac: 'NAAC_Sales_Book',
    solo: 'Solo_Parent_Sales_Book',
  };

  const bookByKey = (key: TabKey): BookRecord[] =>
    key === 'senior' ? data.seniorBook
    : key === 'pwd' ? data.pwdBook
    : key === 'naac' ? data.naacBook
    : data.soloParentBook;

  const tabHasData = (key: TabKey): boolean =>
    key === 'summary' ? data.dailySummary.length > 0 : bookByKey(key).length > 0;

  const dateRangeLabel = `From: ${fromDate ? format(fromDate, 'yyyy-MM-dd') : 'N/A'}  To: ${toDate ? format(toDate, 'yyyy-MM-dd') : 'N/A'}`;
  const fileSuffix = `${format(fromDate || new Date(), 'yyyyMMdd')}_${format(toDate || new Date(), 'yyyyMMdd')}`;

  // ---- Section data builders ------------------------------------------------
  // PDF sections use formatted (comma) strings; Excel sections keep raw numbers
  // so spreadsheet software treats them as numbers (sortable / summable).
  interface PdfSection {
    title: string;
    headers: string[];
    widths: number[];
    rows: string[][];
  }
  interface SheetSection {
    headers: string[];
    rows: (string | number)[][];
  }

  const summaryPdfSection = (): PdfSection => ({
    title: SECTION_LABELS.summary,
    headers: ['Date', 'Beg SI', 'End SI', 'Beg OR', 'End OR', 'Grand Accum Beg', 'Gross Sales', 'Vatable', 'VAT', 'VAT Exempt', 'Zero-Rated', 'Total Deduct.', 'VAT Adj', 'VAT Payable', 'Net Sales'],
    widths: [16, 16, 16, 18, 18, 22, 22, 20, 16, 20, 18, 22, 18, 20, 22],
    rows: data.dailySummary.map((r) => [
      r.date ? format(new Date(r.date), 'yyyy-MM-dd') : '', r.beginningSI, r.endingSI, r.beginningOR, r.endingOR, n2(r.grandAccumulatedBeginning), n2(r.grossSales), n2(r.vatableSales),
      n2(r.vatAmount), n2(r.vatExempt), n2(r.zeroRated), n2(r.totalDeductions), n2(r.totalVatAdjustment), n2(r.vatPayable), n2(r.netSales),
    ]),
  });

  const bookPdfSection = (key: TabKey): PdfSection => ({
    title: SECTION_LABELS[key],
    headers: ['Date', 'Name', 'ID No.', 'TIN', 'SI/OR No.', 'Sales (Incl VAT)', 'VAT', 'VAT Exempt', 'Discount', 'Net Sales'],
    widths: [20, 42, 28, 22, 24, 28, 22, 28, 24, 28],
    rows: bookByKey(key).map((r) => [
      r.date ? format(new Date(r.date), 'yyyy-MM-dd') : '—',
      r.holderName, r.idNumber, r.tin || '—', r.siOrNumber,
      n2(r.salesInclusiveVat), n2(r.vatAmount), n2(r.vatExemptSales), n2(r.discountAmount), n2(r.netSales),
    ]),
  });

  const summarySheetSection = (): SheetSection => ({
    headers: [
      'Date', 'Beginning SI No.', 'Ending SI No.', 'Beginning OR No.', 'Ending OR No.', 'Grand Accumulated Beginning Balance', 'Sales Issued w/ Manual SI/OR',
      'Gross Sales for the Day', 'Vatable Sales', 'VAT Amount', 'VAT Exempt Sales', 'Zero-Rated Sales',
      'SC Discount', 'PWD Discount', 'NAAC Discount', 'Solo Parent Discount', 'Other Discount', 'Returns', 'Voids', 'Total Deductions',
      'VAT Adj - SC', 'VAT Adj - PWD', 'VAT Adj - Other', 'VAT on Returns', 'VAT Adj - Others', 'Total VAT Adjustment',
      'VAT Payable', 'Net Sales', 'Sales Overrun/Overflow', 'Total Income', 'Reset Counter', 'Z-Counter', 'Remarks',
    ],
    rows: data.dailySummary.map((r) => [
      r.date ? format(new Date(r.date), 'yyyy-MM-dd') : '', r.beginningSI, r.endingSI, r.beginningOR, r.endingOR, r.grandAccumulatedBeginning, r.manualSiOr,
      r.grossSales, r.vatableSales, r.vatAmount, r.vatExempt, r.zeroRated,
      r.discSenior, r.discPwd, r.discNaac, r.discSolo, r.discOther, r.returns, r.voids, r.totalDeductions,
      r.vatAdjSenior, r.vatAdjPwd, r.vatAdjOther, r.vatOnReturns, r.vatAdjOthers, r.totalVatAdjustment,
      r.vatPayable, r.netSales, r.salesOverrun, r.totalIncome, r.resetCounter, r.zCounter, r.remarks,
    ]),
  });

  const bookSheetSection = (key: TabKey): SheetSection => ({
    headers: ['Date', 'Name', 'ID No.', 'TIN', 'SI/OR No.', 'Sales (Inclusive of VAT)', 'VAT Amount', 'VAT Exempt Sales', 'Discount', 'Net Sales'],
    rows: bookByKey(key).map((r) => [
      r.date ? format(new Date(r.date), 'yyyy-MM-dd') : '',
      r.holderName, r.idNumber, r.tin || '', r.siOrNumber,
      r.salesInclusiveVat, r.vatAmount, r.vatExemptSales, r.discountAmount, r.netSales,
    ]),
  });

  // ---- PDF export -----------------------------------------------------------
  const exportPdf = (sections: PdfSection[], fileLabel: string) => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 8;
      let yPos = margin;

      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.text('BIR Sales Summary Report', pageWidth / 2, yPos + 2, { align: 'center' });
      yPos += 8;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('(per RR 16-2018)', pageWidth / 2, yPos, { align: 'center' });
      yPos += 5;
      doc.text(dateRangeLabel, pageWidth / 2, yPos, { align: 'center' });
      yPos += 7;

      const drawTable = (title: string, headers: string[], colWidths: number[], rows: string[][]) => {
        if (yPos > pageHeight - 30) {
          doc.addPage();
          yPos = margin;
        }
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text(title, margin, yPos);
        yPos += 5;

        const drawHeader = () => {
          doc.setFillColor(37, 99, 235);
          doc.rect(margin, yPos - 4, colWidths.reduce((a, b) => a + b, 0), 7, 'F');
          doc.setFontSize(6.5);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255);
          let x = margin;
          headers.forEach((h, i) => {
            doc.text(h, x + 1, yPos, { maxWidth: colWidths[i] - 2 });
            x += colWidths[i];
          });
          yPos += 5;
          doc.setTextColor(0, 0, 0);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6);
        };
        drawHeader();

        if (rows.length === 0) {
          doc.text('No records for the selected period.', margin + 1, yPos);
          yPos += 5;
        }

        rows.forEach((row, idx) => {
          if (yPos > pageHeight - 12) {
            doc.addPage();
            yPos = margin;
            drawHeader();
          }
          if (idx % 2 === 0) {
            doc.setFillColor(244, 246, 250);
            doc.rect(margin, yPos - 3.5, colWidths.reduce((a, b) => a + b, 0), 5, 'F');
          }
          let x = margin;
          row.forEach((cell, i) => {
            doc.text(String(cell), x + 1, yPos, { maxWidth: colWidths[i] - 2 });
            x += colWidths[i];
          });
          yPos += 5;
        });
        yPos += 6;
      };

      sections.forEach((s) => drawTable(s.title, s.headers, s.widths, s.rows));

      const fileName = `${fileLabel}_${fileSuffix}.pdf`;
      doc.save(fileName);
      toast({ title: 'PDF Exported', description: `Report saved as ${fileName}` });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast({ title: 'Export Failed', description: 'Failed to generate PDF.', variant: 'destructive' });
    }
  };

  // ---- Excel export (real .xls workbook, no extra dependency) ----------------
  const exportExcel = (sheetName: string, title: string, section: SheetSection, fileLabel: string) => {
    try {
      const esc = (v: any) =>
        String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const isNum = (v: any) => typeof v === 'number';
      const colCount = section.headers.length;

      const thead = `<tr>${section.headers
        .map((h) => `<th style="background:#2563eb;color:#ffffff;border:1px solid #1e3a8a;padding:4px;font-weight:bold;text-align:center">${esc(h)}</th>`)
        .join('')}</tr>`;
      const tbody = section.rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (c) =>
                  `<td style="border:1px solid #cccccc;padding:3px;${isNum(c) ? 'mso-number-format:\\#\\,\\#\\#0\\.00;text-align:right' : ''}">${esc(c)}</td>`
              )
              .join('')}</tr>`
        )
        .join('');

      const html =
        `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
        `<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${esc(sheetName)}</x:Name>` +
        `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>` +
        `<body><table border="0" cellspacing="0">` +
        `<tr><td colspan="${colCount}" style="font-size:15px;font-weight:bold">${esc(title)} (per RR 16-2018)</td></tr>` +
        `<tr><td colspan="${colCount}">${esc(dateRangeLabel)}</td></tr>` +
        `<tr><td colspan="${colCount}"></td></tr>` +
        thead +
        tbody +
        `</table></body></html>`;

      const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${fileLabel}_${fileSuffix}.xls`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast({ title: 'Excel Exported', description: `Report saved as ${link.download}` });
    } catch (error) {
      console.error('Error exporting Excel:', error);
      toast({ title: 'Export Failed', description: 'Failed to generate Excel file.', variant: 'destructive' });
    }
  };

  // ---- Per-tab export handlers ----------------------------------------------
  const exportTab = (key: TabKey, fmt: 'pdf' | 'excel') => {
    if (!tabHasData(key)) {
      toast({ title: 'No Data', description: `No records in "${SECTION_LABELS[key]}" to export.`, variant: 'destructive' });
      return;
    }
    if (fmt === 'pdf') {
      exportPdf([key === 'summary' ? summaryPdfSection() : bookPdfSection(key)], FILE_LABELS[key]);
    } else {
      const section = key === 'summary' ? summarySheetSection() : bookSheetSection(key);
      exportExcel(SECTION_LABELS[key], SECTION_LABELS[key], section, FILE_LABELS[key]);
    }
  };
  const exportActive = (fmt: 'pdf' | 'excel') => exportTab(activeTab, fmt);

  // Compact inline export controls for an individual tab's card header.
  const TabExport = ({ tabKey }: { tabKey: TabKey }) => (
    <div className="flex items-center gap-2 shrink-0">
      <Button
        size="sm"
        variant="outline"
        disabled={isLoading || !tabHasData(tabKey)}
        onClick={() => exportTab(tabKey, 'pdf')}
        className="border-red-200 text-red-600 hover:bg-red-50"
      >
        <FileText className="h-4 w-4 mr-1.5" />
        PDF
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={isLoading || !tabHasData(tabKey)}
        onClick={() => exportTab(tabKey, 'excel')}
        className="border-green-200 text-green-700 hover:bg-green-50"
      >
        <FileSpreadsheet className="h-4 w-4 mr-1.5" />
        Excel
      </Button>
    </div>
  );

  const exportAllPdf = () => {
    if (data.dailySummary.length === 0) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    const sections: PdfSection[] = [summaryPdfSection()];
    (['senior', 'pwd', 'naac', 'solo'] as TabKey[]).forEach((k) => {
      if (bookByKey(k).length) sections.push(bookPdfSection(k));
    });
    exportPdf(sections, 'BIR_Sales_Summary_All');
  };

  const BookTable = ({ records, discountLabel }: { records: BookRecord[]; discountLabel: string }) => {
    const totals = records.reduce(
      (acc, r) => ({
        sales: acc.sales + r.salesInclusiveVat,
        vat: acc.vat + r.vatAmount,
        exempt: acc.exempt + r.vatExemptSales,
        discount: acc.discount + r.discountAmount,
        net: acc.net + r.netSales,
      }),
      { sales: 0, vat: 0, exempt: 0, discount: 0, net: 0 }
    );
    return (
      <Table className="w-full text-xs">
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="py-2 px-2">Date</TableHead>
            <TableHead className="py-2 px-2">Name</TableHead>
            <TableHead className="py-2 px-2">ID No.</TableHead>
            <TableHead className="py-2 px-2">TIN</TableHead>
            <TableHead className="py-2 px-2">SI/OR No.</TableHead>
            <TableHead className="py-2 px-2 text-right">Sales (Incl. VAT)</TableHead>
            <TableHead className="py-2 px-2 text-right">VAT Amount</TableHead>
            <TableHead className="py-2 px-2 text-right">VAT Exempt Sales</TableHead>
            <TableHead className="py-2 px-2 text-right">{discountLabel}</TableHead>
            <TableHead className="py-2 px-2 text-right">Net Sales</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.length > 0 ? (
            records.map((r, i) => (
              <TableRow key={i} className="hover:bg-muted/50 transition-colors">
                <TableCell className="py-2 px-2 whitespace-nowrap">
                  {r.date ? format(new Date(r.date), 'MMM d, yyyy') : '—'}
                </TableCell>
                <TableCell className="py-2 px-2 font-medium">{r.holderName}</TableCell>
                <TableCell className="py-2 px-2 font-mono text-muted-foreground">{r.idNumber}</TableCell>
                <TableCell className="py-2 px-2 font-mono text-muted-foreground">{r.tin || '—'}</TableCell>
                <TableCell className="py-2 px-2 font-mono">{r.siOrNumber}</TableCell>
                <TableCell className="py-2 px-2 text-right font-mono">{n2(r.salesInclusiveVat)}</TableCell>
                <TableCell className="py-2 px-2 text-right font-mono">{n2(r.vatAmount)}</TableCell>
                <TableCell className="py-2 px-2 text-right font-mono">{n2(r.vatExemptSales)}</TableCell>
                <TableCell className="py-2 px-2 text-right font-mono text-orange-600">{n2(r.discountAmount)}</TableCell>
                <TableCell className="py-2 px-2 text-right font-mono text-green-700">{n2(r.netSales)}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={10} className="h-20 text-center text-muted-foreground">
                {isLoading ? 'Loading...' : 'No records found for the selected period.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {records.length > 0 && (
          <TableFooter>
            <TableRow className="bg-muted/70 font-bold border-t-2">
              <TableCell className="py-2 px-2" colSpan={5}>TOTAL ({records.length})</TableCell>
              <TableCell className="py-2 px-2 text-right font-mono">{n2(totals.sales)}</TableCell>
              <TableCell className="py-2 px-2 text-right font-mono">{n2(totals.vat)}</TableCell>
              <TableCell className="py-2 px-2 text-right font-mono">{n2(totals.exempt)}</TableCell>
              <TableCell className="py-2 px-2 text-right font-mono text-orange-700">{n2(totals.discount)}</TableCell>
              <TableCell className="py-2 px-2 text-right font-mono text-green-700">{n2(totals.net)}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-blue-600" />
                BIR Sales Summary Report
              </CardTitle>
              <CardDescription>
                Daily sales summary with VAT breakdown, deductions and statutory sales books (per RR 16-2018).
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-sm border-blue-600 text-blue-600">
              {data.dailySummary.length} Day{data.dailySummary.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[180px] justify-start text-left font-normal', !fromDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, 'PPP') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-[180px] justify-start text-left font-normal', !toDate && 'text-muted-foreground')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'PPP') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Show Report'}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isLoading || data.dailySummary.length === 0}
                  variant="outline"
                  className="border-blue-600 text-blue-600 hover:bg-blue-50"
                >
                  <FileDown className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="truncate">Current tab: {SECTION_LABELS[activeTab]}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => exportActive('pdf')} disabled={!tabHasData(activeTab)}>
                  <FileText className="h-4 w-4 mr-2 text-red-600" />
                  Export this tab to PDF
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportActive('excel')} disabled={!tabHasData(activeTab)}>
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />
                  Export this tab to Excel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={exportAllPdf}>
                  <FileDown className="h-4 w-4 mr-2" />
                  Export all sections (PDF)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gross Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{peso(summaryTotals.grossSales)}</div>
            <p className="text-xs text-muted-foreground">Total for the period</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Deductions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{peso(summaryTotals.totalDeductions)}</div>
            <p className="text-xs text-muted-foreground">Discounts, returns & voids</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">VAT Payable</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{peso(summaryTotals.vatPayable)}</div>
            <p className="text-xs text-muted-foreground">Net of VAT adjustments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{peso(summaryTotals.netSales)}</div>
            <p className="text-xs text-muted-foreground">Total income</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5">
          <TabsTrigger value="summary">Daily Summary</TabsTrigger>
          <TabsTrigger value="senior">Senior Citizen</TabsTrigger>
          <TabsTrigger value="pwd">PWD</TabsTrigger>
          <TabsTrigger value="naac">NAAC</TabsTrigger>
          <TabsTrigger value="solo">Solo Parent</TabsTrigger>
        </TabsList>

        {/* Daily Summary */}
        <TabsContent value="summary">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Daily Sales Summary</CardTitle>
                  <CardDescription>Per-day gross sales, VAT breakdown, deductions and VAT adjustments.</CardDescription>
                </div>
                <TabExport tabKey="summary" />
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="w-full text-xs">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="py-2 px-2 whitespace-nowrap">Date</TableHead>
                    <TableHead className="py-2 px-2 whitespace-nowrap">Beg. SI No.</TableHead>
                    <TableHead className="py-2 px-2 whitespace-nowrap">End. SI No.</TableHead>
                    <TableHead className="py-2 px-2 whitespace-nowrap">Beg. OR No.</TableHead>
                    <TableHead className="py-2 px-2 whitespace-nowrap">End. OR No.</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">Grand Accum. Beg.</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">Gross Sales</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">Vatable Sales</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">VAT Amount</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">VAT Exempt</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">Zero-Rated</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">Total Deductions</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">VAT Adjustment</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">VAT Payable</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">Net Sales</TableHead>
                    <TableHead className="py-2 px-2 text-right whitespace-nowrap">Total Income</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.dailySummary.length > 0 ? (
                    data.dailySummary.map((r, i) => (
                      <TableRow key={i} className="hover:bg-muted/50 transition-colors">
                        <TableCell className="py-2 px-2 whitespace-nowrap">{format(new Date(r.date), 'MMM d, yyyy')}</TableCell>
                        <TableCell className="py-2 px-2 font-mono">{r.beginningSI}</TableCell>
                        <TableCell className="py-2 px-2 font-mono">{r.endingSI}</TableCell>
                        <TableCell className="py-2 px-2 font-mono">{r.beginningOR}</TableCell>
                        <TableCell className="py-2 px-2 font-mono">{r.endingOR}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono text-muted-foreground">{n2(r.grandAccumulatedBeginning)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono">{n2(r.grossSales)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono">{n2(r.vatableSales)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono">{n2(r.vatAmount)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono">{n2(r.vatExempt)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono">{n2(r.zeroRated)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono text-orange-600">{n2(r.totalDeductions)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono text-purple-600">{n2(r.totalVatAdjustment)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono text-purple-700">{n2(r.vatPayable)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono text-green-700">{n2(r.netSales)}</TableCell>
                        <TableCell className="py-2 px-2 text-right font-mono font-semibold text-green-700">{n2(r.totalIncome)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={16} className="h-24 text-center text-muted-foreground">
                        {isLoading ? 'Loading...' : 'No sales found for the selected period.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
                {data.dailySummary.length > 0 && (
                  <TableFooter>
                    <TableRow className="bg-muted/70 font-bold border-t-2">
                      <TableCell className="py-2 px-2" colSpan={6}>GRAND TOTAL</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono">{n2(summaryTotals.grossSales)}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono">{n2(data.dailySummary.reduce((s, r) => s + r.vatableSales, 0))}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono">{n2(data.dailySummary.reduce((s, r) => s + r.vatAmount, 0))}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono">{n2(data.dailySummary.reduce((s, r) => s + r.vatExempt, 0))}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono">{n2(data.dailySummary.reduce((s, r) => s + r.zeroRated, 0))}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono text-orange-700">{n2(summaryTotals.totalDeductions)}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono text-purple-700">{n2(data.dailySummary.reduce((s, r) => s + r.totalVatAdjustment, 0))}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono text-purple-700">{n2(summaryTotals.vatPayable)}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono text-green-700">{n2(summaryTotals.netSales)}</TableCell>
                      <TableCell className="py-2 px-2 text-right font-mono text-green-700">{n2(summaryTotals.netSales)}</TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </CardContent>
          </Card>

          {/* Deductions & VAT adjustment breakdown */}
          {data.dailySummary.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Deductions Breakdown</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  {[
                    ['Senior Citizen Discount', data.dailySummary.reduce((s, r) => s + r.discSenior, 0)],
                    ['PWD Discount', data.dailySummary.reduce((s, r) => s + r.discPwd, 0)],
                    ['NAAC Discount', data.dailySummary.reduce((s, r) => s + r.discNaac, 0)],
                    ['Solo Parent Discount', data.dailySummary.reduce((s, r) => s + r.discSolo, 0)],
                    ['Other Discounts', data.dailySummary.reduce((s, r) => s + r.discOther, 0)],
                    ['Returns', data.dailySummary.reduce((s, r) => s + r.returns, 0)],
                    ['Voids', data.dailySummary.reduce((s, r) => s + r.voids, 0)],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono">{peso(val as number)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-bold">
                    <span>Total Deductions</span>
                    <span className="font-mono text-orange-700">{peso(summaryTotals.totalDeductions)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">VAT Adjustment Breakdown</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  {[
                    ['Senior Citizen Discount', data.dailySummary.reduce((s, r) => s + r.vatAdjSenior, 0)],
                    ['PWD Discount', data.dailySummary.reduce((s, r) => s + r.vatAdjPwd, 0)],
                    ['Other Discount', data.dailySummary.reduce((s, r) => s + r.vatAdjOther, 0)],
                    ['VAT on Returns', data.dailySummary.reduce((s, r) => s + r.vatOnReturns, 0)],
                    ['Others', data.dailySummary.reduce((s, r) => s + r.vatAdjOthers, 0)],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono">{peso(val as number)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-bold">
                    <span>Total VAT Adjustment</span>
                    <span className="font-mono text-purple-700">{peso(data.dailySummary.reduce((s, r) => s + r.totalVatAdjustment, 0))}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="senior">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Senior Citizen Sales Book</CardTitle>
                  <CardDescription>Sales transactions with Senior Citizen (SC) discount — OSCA / SC ID No.</CardDescription>
                </div>
                <TabExport tabKey="senior" />
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <BookTable records={data.seniorBook} discountLabel="Discount (5% & 20%)" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pwd">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Person With Disability (PWD) Sales Book</CardTitle>
                  <CardDescription>Sales transactions with PWD discount — PWD ID No.</CardDescription>
                </div>
                <TabExport tabKey="pwd" />
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <BookTable records={data.pwdBook} discountLabel="Discount (5% & 20%)" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="naac">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>National Athletes &amp; Coaches Sales Book</CardTitle>
                  <CardDescription>Sales transactions with NAAC discount — PNSTM ID No.</CardDescription>
                </div>
                <TabExport tabKey="naac" />
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <BookTable records={data.naacBook} discountLabel="Sales Discount" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="solo">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Solo Parent Sales Book</CardTitle>
                  <CardDescription>Sales transactions with Solo Parent discount — SPIC No.</CardDescription>
                </div>
                <TabExport tabKey="solo" />
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <BookTable records={data.soloParentBook} discountLabel="Discount" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
