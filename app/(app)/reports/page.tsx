
'use client';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import Link from 'next/link';
import { Package, ArrowLeftRight, AlertTriangle, TrendingUp, ClipboardList, Receipt, Package2, Percent, Undo, Users, BarChart, LineChart, PhilippinePeso, ShoppingCart, Layers, CreditCard, ShieldCheck, Landmark, Calendar, CalendarClock, Tags, FileBarChart, ReceiptText, ClipboardCheck, ActivitySquare, ListChecks, FileSearch, CalendarDays, Ban, Banknote } from 'lucide-react';

export default function ReportsPage() {
  return (
    <div className="grid gap-6 auto-rows-max">
      {/* Inventory Reports Section */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Inventory Reports</h2>
        <p className="text-muted-foreground">
          Comprehensive inventory tracking, stock levels, and movement analysis.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/reports/inventory">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Stock on Hand & Valuation
                </CardTitle>
                <CardDescription>Current inventory levels and total value (Avg Cost).</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/cost-vs-retail">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Percent className="h-5 w-5 text-emerald-600" />
                  Cost vs Retail Valuation
                </CardTitle>
                <CardDescription>Stock value at cost vs selling price, with potential profit and margin.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/movements">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ArrowLeftRight className="h-5 w-5" />
                  Stock Movement
                </CardTitle>
                <CardDescription>History of stock changes with date filtering.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/low-stock">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  Low Stock Report
                </CardTitle>
                <CardDescription>Products below reorder point.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/velocity">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Fast & Slow Moving
                </CardTitle>
                <CardDescription>Product sales velocity analysis.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/adjustments">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Adjustment Report
                </CardTitle>
                <CardDescription>Log of damaged, lost, or corrected stock.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/expiring-soon">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-red-500" />
                  Expiring Soon
                </CardTitle>
                <CardDescription>Stock on hand approaching its expiration date.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/barcode-labels">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tags className="h-5 w-5 text-slate-600" />
                  Print Barcode Labels
                </CardTitle>
                <CardDescription>Bulk-print or export barcode labels for a whole product category.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
      </div>

      {/* POS Reports Section */}
      <div className="space-y-2 mt-8">
        <h2 className="text-2xl font-bold tracking-tight">POS Reports</h2>
        <p className="text-muted-foreground">
          Cashier shift readings and BIR-mandated locked reports.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/sales">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5 text-blue-600" />
                  POS Sales Transaction
                </CardTitle>
                <CardDescription>List of all POS sales to customers with filters and summary totals.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/details">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSearch className="h-5 w-5 text-blue-500" />
                  POS Sales Detail
                </CardTitle>
                <CardDescription>Line-item level detail behind each POS sale.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/by-product">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package2 className="h-5 w-5 text-green-600" />
                  Sales by Product/Service
                </CardTitle>
                <CardDescription>Product/service performance breakdown from the Sales module.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/by-date">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-indigo-500" />
                  Sales by Date
                </CardTitle>
                <CardDescription>Sales totals broken down by date.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/returns">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Undo className="h-5 w-5 text-orange-600" />
                  Merchandise Credits
                </CardTitle>
                <CardDescription>Returns and merchandise credit processing history.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/voids">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ban className="h-5 w-5 text-red-500" />
                  Post Void
                </CardTitle>
                <CardDescription>Voided sales transactions log.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/cash-transfer">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Banknote className="h-5 w-5 text-emerald-600" />
                  POS Cash Transfer
                </CardTitle>
                <CardDescription>Cash drawer transfers between cashiers and terminals.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/z-reading">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ReceiptText className="h-5 w-5 text-red-600" />
                  POS Z-Reading
                </CardTitle>
                <CardDescription>End-of-day locked sales report required for tax filing.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/x-reading">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileBarChart className="h-5 w-5 text-orange-600" />
                  POS X-Reading
                </CardTitle>
                <CardDescription>Shift-in-progress sales reading without resetting totals.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/overall-reading">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-teal-600" />
                  POS Overall Reading
                </CardTitle>
                <CardDescription>Combined sales reading across all terminals.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/sales/analysis">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ActivitySquare className="h-5 w-5 text-violet-600" />
                  Sales Analysis
                </CardTitle>
                <CardDescription>Trend analysis across sales activity over time.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
      </div>

      {/* Sales Reports Section */}
      <div className="space-y-2 mt-8">
        <h2 className="text-2xl font-bold tracking-tight">Sales Reports</h2>
        <p className="text-muted-foreground">
          Comprehensive sales analysis, revenue tracking, and customer insights.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/reports/sales/summary">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PhilippinePeso className="h-5 w-5 text-blue-600" />
                  Sales Summary
                </CardTitle>
                <CardDescription>Overall sales transactions with revenue, profit, and tax analysis.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/by-product">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package2 className="h-5 w-5 text-green-600" />
                  Sales by Product
                </CardTitle>
                <CardDescription>Product performance analysis with units sold and revenue breakdown.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/top-volume">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart className="h-5 w-5 text-indigo-500" />
                  Top by Volume
                </CardTitle>
                <CardDescription>Highest selling items based on quantity sold.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/top-sales">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LineChart className="h-5 w-5 text-rose-500" />
                  Top by Sales
                </CardTitle>
                <CardDescription>Highest revenue generating items.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/profit-margin">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Percent className="h-5 w-5 text-purple-600" />
                  Profit Margin Report
                </CardTitle>
                <CardDescription>Profitability analysis with margin percentages and ROI metrics.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/returns">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Undo className="h-5 w-5 text-orange-600" />
                  Sales Returns
                </CardTitle>
                <CardDescription>Merchandise credit report with returned items and refund tracking.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/batch-profit">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-amber-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-amber-600" />
                  Batch Profit Analysis
                </CardTitle>
                <CardDescription>Granular profit analysis per inventory batch with FIFO cost tracking.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/by-customer">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-600" />
                  Sales by Customer
                </CardTitle>
                <CardDescription>Customer purchase history with credit sales and outstanding balances.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/split-payments">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-blue-100 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-500" />
                  Split Payments Report
                </CardTitle>
                <CardDescription>Breakdown of sales transactions paid with multiple payment methods.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/discounts">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  Discount Report
                </CardTitle>
                <CardDescription>Senior Citizen, PWD, NAAC, and Solo Parent discounts with cardholder name and ID number (BIR).</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/sales/bir-summary">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Landmark className="h-5 w-5 text-blue-700" />
                  BIR Sales Summary
                </CardTitle>
                <CardDescription>Daily sales summary with VAT breakdown, deductions, and SC/PWD/NAAC/Solo Parent sales books (RR 16-2018).</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/membership">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-amber-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-amber-600" />
                  Membership Report
                </CardTitle>
                <CardDescription>Membership activations and renewals with cashier, amount, and validity.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/fiscal-year">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-blue-600" />
                  Fiscal Year Report
                </CardTitle>
                <CardDescription>Revenue, transactions, and profit for a chosen fiscal year with monthly breakdown.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
      </div>

      {/* Purchases Reports Section */}
      <div className="space-y-2 mt-8">
        <h2 className="text-2xl font-bold tracking-tight">Purchases Reports</h2>
        <p className="text-muted-foreground">
          Analyze procurement activity, supplier spending, and product costs.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/reports/purchases/summary">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-blue-600" />
                  Purchases Summary
                </CardTitle>
                <CardDescription>Overview of all purchase orders with status and payment tracking.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/purchases/by-supplier">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-600" />
                  Purchases by Supplier
                </CardTitle>
                <CardDescription>Spending analysis per supplier with order frequency and last purchase.</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/reports/purchases/by-product">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package2 className="h-5 w-5 text-green-600" />
                  Purchases by Product
                </CardTitle>
                <CardDescription>Detailed breakdown of item procurement with cost and quantity analysis.</CardDescription>
              </CardHeader>
            </Card>
          </Link>
      </div>
    </div>
  );
}
