'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X, Download, ChevronDown, PlusCircle } from 'lucide-react';

import { AddPurchaseOrderDialog } from './add-purchase-order/add-purchase-order-dialog';
import { ReceivePurchaseOrderDialog } from './receive-purchase-order/receive-purchase-order-dialog';
import { ViewPurchaseOrderDialog } from './view-purchase-order/view-purchase-order-dialog';
import { ScheduledOrdersDialog } from './scheduled-orders-dialog';
import { PurchasesFilterDialog } from './purchases-filter-dialog';
import { PurchaseOrderRow } from './purchases-list/purchase-order-row';
import { usePurchasesPage } from './purchases-list/use-purchases-page';

export default function PurchasesPage() {
  const router = useRouter();
  const controller = usePurchasesPage();
  const {
    purchaseOrders,
    pagination,
    suppliers,
    settings,

    searchQuery, setSearchQuery,
    dateRange, setDateRange,
    statusFilter, setStatusFilter,
    supplierFilter, setSupplierFilter,
    currentPage, setCurrentPage,
    pageSize, setPageSize,
    hasActiveFilters,

    editingOrder,
    isEditOpen, setIsEditOpen,
    reorderData,
    isReorderOpen, setIsReorderOpen,
    isReceiveDialogOpen, setIsReceiveDialogOpen,
    orderToReceive,
    viewingOrder, setViewingOrder,

    updatePurchaseOrder,
    handleReceiveConfirm,
    handleReceiveOpen,
    addPurchaseOrder,
    handleSearch,
    resetFilters,
    handlePrint,
    handleExport,
    handleEdit,
    handleReorder,
    handleViewDetails,
  } = controller;

  return (
    <Card className="printable-area">
      <CardHeader className="non-printable">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Purchases</CardTitle>
            <CardDescription>
              A list of all purchase orders from your suppliers.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <ScheduledOrdersDialog
              onCreateOrder={(supplierId) => {
                router.push(`/purchases/new?supplierId=${encodeURIComponent(supplierId)}`);
              }}
            />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('pdf')}>Export as PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button size="sm" asChild>
              <Link href="/purchases/new">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add New Purchase Order
              </Link>
            </Button>

            {isEditOpen && editingOrder && (
              <AddPurchaseOrderDialog
                editOrder={editingOrder}
                open={isEditOpen}
                onOpenChange={setIsEditOpen}
                onAddOrder={(order) => {
                  addPurchaseOrder(order);
                  setIsEditOpen(false);
                }}
              />
            )}

            {isReorderOpen && reorderData && (
              <AddPurchaseOrderDialog
                reorderData={reorderData}
                open={isReorderOpen}
                onOpenChange={setIsReorderOpen}
                onAddOrder={(order) => {
                  addPurchaseOrder(order);
                  setIsReorderOpen(false);
                }}
              />
            )}

            {orderToReceive && (
              <ReceivePurchaseOrderDialog
                open={isReceiveDialogOpen}
                onOpenChange={setIsReceiveDialogOpen}
                order={orderToReceive}
                onConfirm={handleReceiveConfirm}
                requireConfirmation={settings?.requireReceiveConfirmation}
              />
            )}

            <ViewPurchaseOrderDialog
              open={!!viewingOrder}
              onOpenChange={(open) => !open && setViewingOrder(null)}
              order={viewingOrder}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by ID, supplier..."
                className="pl-8 sm:w-[250px]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <Button variant="secondary" onClick={handleSearch}>
              Search
            </Button>

            <PurchasesFilterDialog
              status={statusFilter}
              setStatus={setStatusFilter}
              supplierId={supplierFilter}
              setSupplierId={setSupplierFilter}
              dateRange={dateRange}
              setDateRange={setDateRange}
              suppliers={suppliers}
              onReset={resetFilters}
            />
          </div>

          <div className="flex items-center gap-2 non-printable">
            {hasActiveFilters && (
              <Button variant="ghost" onClick={resetFilters} size="sm" className="h-8 px-2 text-xs">
                <X className="mr-1 h-3 w-3" />
                Reset
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="m-4">
          <Table
            className="text-xs"
            wrapperClassName="max-h-[calc(100vh-320px)] overflow-auto rounded-md border border-separate border-spacing-0"
          >
            <TableHeader className="bg-muted/50 backdrop-blur-sm">
              <TableRow className="hover:bg-transparent bg-muted/50">
                <TableHead className="w-8 p-1 text-center" />
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground whitespace-nowrap">Ref No</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground whitespace-nowrap">Ordered by</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground text-right whitespace-nowrap">Order Total</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground text-right whitespace-nowrap">Shipping</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground text-right whitespace-nowrap">Included Vat</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground text-right whitespace-nowrap">Grand total</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground text-right whitespace-nowrap">Received Total</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground whitespace-nowrap">Supplier</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground whitespace-nowrap">Issue date</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground whitespace-nowrap">Delivery date</TableHead>
                <TableHead className="h-8 px-2 py-1 font-semibold text-foreground text-center whitespace-nowrap">Status</TableHead>
                <TableHead className="w-8 p-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchaseOrders?.map((order) => (
                <PurchaseOrderRow
                  key={order.id}
                  order={order}
                  onUpdateOrder={updatePurchaseOrder}
                  onReceive={handleReceiveOpen}
                  onPrint={handlePrint}
                  onReorder={handleReorder}
                  onEdit={handleEdit}
                  onViewDetails={handleViewDetails}
                  settings={settings}
                />
              ))}
            </TableBody>
          </Table>
        </div>

        {pagination && pagination.total > 0 && (
          <div className="py-2 border-t px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page:</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(val) => setPageSize(parseInt(val))}
              >
                <SelectTrigger className="h-8 w-[70px] text-xs">
                  <SelectValue placeholder={pageSize.toString()} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Pagination className="w-auto mx-0">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="text-xs text-muted-foreground px-4 whitespace-nowrap">
                    Page {currentPage} of {Math.ceil(pagination.total / pageSize)}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage((p) => p + 1)}
                    className={!pagination.hasMore ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
