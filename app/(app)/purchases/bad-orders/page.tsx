'use client';

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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Link from 'next/link';
import { AlertTriangle, Search, X } from 'lucide-react';
import { DataTablePagination } from '@/components/ui/data-table-pagination';

import { BadOrderStats } from './bad-order-stats';
import { ViewBadOrderDialog } from './view-bad-order-dialog';
import { BadOrderSkeleton } from './bad-order-skeleton';
import { BadOrderRow } from './bad-order-row';
import { useBadOrdersPage } from './use-bad-orders-page';

export default function BadOrdersPage() {
  const {
    badOrders,
    loading,
    refetch,
    pagination,

    searchQuery, setSearchQuery,
    statusFilter, setStatusFilter,
    currentPage, setCurrentPage,
    pageSize, setPageSize,
    viewingOrder, setViewingOrder,
    hasActiveFilters,

    handleSearch,
    resetFilters,
  } = useBadOrdersPage();

  return (
    <div className="space-y-4">
      <BadOrderStats />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Bad Orders</CardTitle>
              <CardDescription>
                Track and manage defective or damaged items from suppliers
              </CardDescription>
            </div>
            <Button asChild>
              <Link href="/purchases/bad-orders/new">
                <AlertTriangle className="mr-2 h-4 w-4" />
                Record Bad Order
              </Link>
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4">
            <div className="relative flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search by ID, PO, supplier..."
                  className="pl-8 sm:w-[300px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button variant="secondary" onClick={handleSearch}>
                Search
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Reported">Reported</SelectItem>
                  <SelectItem value="Return Requested">Return Requested</SelectItem>
                  <SelectItem value="Replaced">Replaced</SelectItem>
                  <SelectItem value="Credited">Credited</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button variant="ghost" onClick={resetFilters} size="icon">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Reset filters</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table wrapperClassName="max-h-[calc(100vh-400px)] overflow-auto relative m-4 border rounded-md">
            <TableHeader className="sticky top-0 z-30 bg-background shadow-sm">
              <TableRow className="hover:bg-transparent bg-muted/50">
                <TableHead className="font-semibold text-foreground">Bad Order ID</TableHead>
                <TableHead className="font-semibold text-foreground">Supplier</TableHead>
                <TableHead className="font-semibold text-foreground">Report Date</TableHead>
                <TableHead className="font-semibold text-foreground text-right">Total Value</TableHead>
                <TableHead className="font-semibold text-foreground text-center">Status</TableHead>
                <TableHead className="font-semibold text-foreground">Reported By</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <>
                  <BadOrderSkeleton />
                  <BadOrderSkeleton />
                  <BadOrderSkeleton />
                </>
              ) : badOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No bad orders found
                  </TableCell>
                </TableRow>
              ) : (
                badOrders.map((order) => (
                  <BadOrderRow
                    key={order.id}
                    order={order}
                    onView={setViewingOrder}
                  />
                ))
              )}
            </TableBody>
          </Table>

          {pagination && pagination.total > 0 && (
            <div className="py-2 border-t px-4">
              <DataTablePagination
                currentPage={currentPage}
                totalPages={Math.ceil(pagination.total / pageSize)}
                pageSize={pageSize}
                totalItems={pagination.total}
                setPage={setCurrentPage}
                setPageSize={setPageSize}
              />
            </div>
          )}
        </CardContent>

        <ViewBadOrderDialog
          open={!!viewingOrder}
          onOpenChange={(open: boolean) => !open && setViewingOrder(null)}
          badOrder={viewingOrder}
          onUpdate={refetch}
        />
      </Card>
    </div>
  );
}
