'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Save, CheckCircle, Search, AlertTriangle, Printer, Package, FileDown,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

import { useCountDetail, ITEM_PAGE_SIZE_OPTIONS } from './use-count-detail';
import { MobileItemCard } from './mobile-item-card';
import { CountItemRow } from './count-item-row';
import { ReviewDialog } from './review-dialog';
import { PrintLayout } from './print-layout';
import { Pagination } from '../pagination';

export function CountDetailClient({ countId }: { countId: string }) {
  const {
    count,
    items,
    search,
    searchTerm,
    setSearchTerm,
    handleSearch,
    handleSearchKeyDown,
    isSearchPending,
    isLoading,
    isSaving,
    isCompleting,
    isPrinting,
    isExporting,
    showReviewDialog,
    setShowReviewDialog,
    router,
    searchInputRef,
    handleQuantityChange,
    handleFocusSearch,
    handleSaveProgress,
    handleComplete,
    handlePrint,
    handleExportPDF,
    filteredItems,
    paginatedItems,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    itemsWithVariances,
    uncountedItems,
    countedCount,
    progressPct,
    totalVariance,
    totalVarianceAmount,
    printPageVariance,
    printPageVarianceAmount,
  } = useCountDetail({ countId });

  // ── Loading / not found ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground text-sm">Loading count details…</p>
      </div>
    );
  }

  if (!count) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <AlertTriangle className="h-10 w-10 text-muted-foreground opacity-50" />
        <p className="text-muted-foreground">Count not found.</p>
        <Button variant="outline" size="sm" onClick={() => router.push('/inventory/stock-counts')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Go Back
        </Button>
      </div>
    );
  }

  const isCompleted = count.status === 'completed';

  return (
    <>
      <div className="space-y-4 non-printable">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          {/* Back + Title */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              className="flex-shrink-0 h-9 w-9 rounded-xl"
              onClick={() => router.push('/inventory/stock-counts')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold leading-tight">{count.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant={isCompleted ? 'default' : 'secondary'} className="text-[10px]">
                  {count.status.replace('_', ' ').toUpperCase()}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(count.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons – full-width on mobile, auto on sm+ */}
          <div className="flex flex-wrap gap-2 w-full sm:w-auto non-printable">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="flex-1 sm:flex-none"
              title={`Prints the current page (${paginatedItems.length} of ${filteredItems.length} items). Use the row-count selector below to fit more per page.`}
            >
              <Printer className="h-4 w-4 mr-1.5" />
              <span className="sm:inline">Print Page</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={isExporting || items.length === 0}
              className="flex-1 sm:flex-none"
              title={`Exports all ${items.length} items in this count to a PDF (ignores search).`}
            >
              <FileDown className="h-4 w-4 mr-1.5" />
              <span className="sm:inline">{isExporting ? 'Exporting…' : 'Export All (PDF)'}</span>
            </Button>
            {!isCompleted && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveProgress}
                  disabled={isSaving}
                  className="flex-1 sm:flex-none"
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowReviewDialog(true)}
                  className="flex-1 sm:flex-none"
                >
                  <CheckCircle className="h-4 w-4 mr-1.5" />
                  Review &amp; Complete
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Progress bar (mobile-friendly summary) ─────────────────────── */}
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Counting Progress</span>
            <span className="text-muted-foreground">
              {countedCount} / {items.length} ({progressPct}%)
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-400 inline-block" />
              Variances: {itemsWithVariances.length}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-muted-foreground inline-block" />
              Uncounted: {uncountedItems.length}
            </span>
            <span className="flex items-center gap-1">
              Total Variance:{' '}
              <span
                className={`font-semibold ${
                  totalVariance < 0
                    ? 'text-red-500'
                    : totalVariance > 0
                    ? 'text-green-500'
                    : 'text-foreground'
                }`}
              >
                {totalVariance > 0 ? `+${totalVariance}` : totalVariance}
              </span>
            </span>
            <span className="flex items-center gap-1">
              Total Amount Variance:{' '}
              <span
                className={`font-semibold ${
                  totalVarianceAmount < 0
                    ? 'text-red-500'
                    : totalVarianceAmount > 0
                    ? 'text-green-500'
                    : 'text-foreground'
                }`}
              >
                {formatCurrency(totalVarianceAmount)}
              </span>
            </span>
          </div>
        </div>

        {/* ── Search bar ─────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchInputRef}
              placeholder="Scan barcode or search name / SKU, then press Enter…"
              className="pl-9 w-full"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              autoFocus
            />
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={handleSearch}
            disabled={!isSearchPending}
            title="Apply search"
          >
            <Search className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Search</span>
          </Button>
        </div>

        {/* ── Mobile card list (hidden on md+) ───────────────────────────── */}
        <div className="flex flex-col gap-2 md:hidden">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
              {search ? `No products matching "${search}"` : 'No items in this count.'}
            </div>
          ) : (
            paginatedItems.map((item) => (
              <MobileItemCard
                key={item.id}
                item={item}
                isCompleted={isCompleted}
                onChange={handleQuantityChange}
                onEnter={handleFocusSearch}
              />
            ))
          )}
          {filteredItems.length > 0 && (
            <Pagination
              total={filteredItems.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={ITEM_PAGE_SIZE_OPTIONS}
            />
          )}
        </div>

        {/* ── Desktop table (hidden on mobile) ───────────────────────────── */}
        <div className="hidden md:block rounded-md border bg-card text-card-foreground shadow-sm">
          <div className="p-4 border-b flex items-center justify-end bg-muted/20">
            <div className="text-sm text-muted-foreground flex gap-4">
              <span>Total: {items.length}</span>
              <span>Counted: {countedCount}</span>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product Name</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead className="text-right">Expected (Snapshot)</TableHead>
                <TableHead className="text-right w-48">Actual Count</TableHead>
                <TableHead className="text-right">Cost Amount</TableHead>
                <TableHead className="text-right">Retail Amount</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Variance Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.map((item) => (
                <CountItemRow
                  key={item.id}
                  item={item}
                  isCompleted={isCompleted}
                  onChange={handleQuantityChange}
                  onEnter={handleFocusSearch}
                />
              ))}
              {filteredItems.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No products found matching &quot;{search}&quot;
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {filteredItems.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6} className="text-right font-semibold">
                    Totals
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold ${
                      totalVariance < 0
                        ? 'text-red-500'
                        : totalVariance > 0
                        ? 'text-green-500'
                        : ''
                    }`}
                  >
                    {totalVariance > 0 ? `+${totalVariance}` : totalVariance}
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold ${
                      totalVarianceAmount < 0
                        ? 'text-red-500'
                        : totalVarianceAmount > 0
                        ? 'text-green-500'
                        : ''
                    }`}
                  >
                    {formatCurrency(totalVarianceAmount)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
          {filteredItems.length > 0 && (
            <div className="p-4 border-t">
              <Pagination
                total={filteredItems.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                pageSizeOptions={ITEM_PAGE_SIZE_OPTIONS}
              />
            </div>
          )}
        </div>

        {/* ── Review Dialog — mounted only while open. It renders two full-size lists
             (mobile cards + desktop table rows) over every item in the count; with a
             whole-store count that's 15k+ elements built on every render, and since it
             lived permanently in the tree, every keystroke elsewhere on this screen (a
             search key change re-renders the whole page) rebuilt all of it — that was
             the actual cause of the search lag, not the visible item table. ─────── */}
        {showReviewDialog && (
          <ReviewDialog
            open={showReviewDialog}
            onOpenChange={setShowReviewDialog}
            count={count}
            items={items}
            countedCount={countedCount}
            variancesCount={itemsWithVariances.length}
            uncountedCount={uncountedItems.length}
            isCompleting={isCompleting}
            onComplete={handleComplete}
          />
        )}
      </div>

      {/* ── Dedicated Print Layout — mounted only while printing, and scoped to the
           current page. With a count spanning the whole catalog (thousands of rows),
           printing everything at once both froze the page and produced a garbled/
           overlapping print preview from the print engine choking on ~2000 pages
           worth of cells — so print covers one page at a time, same as the screen. */}
      {isPrinting && (
        <PrintLayout
          count={count}
          printItems={paginatedItems}
          isCompleted={isCompleted}
          totalVariance={printPageVariance}
          totalVarianceAmount={printPageVarianceAmount}
          page={page}
          totalPages={totalPages}
        />
      )}
    </>
  );
}
