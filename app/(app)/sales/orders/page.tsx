
'use client';

import { useState } from 'react';
import { SortingState, VisibilityState } from '@tanstack/react-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Sale } from '@/lib/types';
import { useOrdersQuery, useSalesPersonsQuery, useCustomersQuery, useOrdersMutations } from './use-orders-query';
import { useOrdersFilters } from './use-orders-filters';
import { useOrdersTable } from './use-orders-table';
import { OrdersSummaryCards } from './OrdersSummaryCards';
import { OrdersFilterBar } from './OrdersFilterBar';
import { OrdersTable } from './OrdersTable';
import { OrdersFilterDialogs } from './OrdersFilterDialogs';
import { AddSalesOrderDialog } from './add-order/add-sales-order-dialog';
import { OrderDetailsDialog, OrderDialogMode } from './order-details/order-details-dialog';

export default function SalesOrdersPage() {
  const f = useOrdersFilters();

  const { sales, summary, totalPages, isLoading, refetch } = useOrdersQuery({
    currentPage: f.currentPage,
    limit: f.limit,
    filters: f.filters,
    searchTerm: f.searchTerm,
  });

  const { data: salesPersons = [] } = useSalesPersonsQuery();
  const { data: customers = [] } = useCustomersQuery();
  const { deleteMutation, makeDeliveryMutation, makeInvoiceMutation } = useOrdersMutations();

  // Edit state
  const [orderToEdit, setOrderToEdit] = useState<Sale | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Delete state
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);

  // Order details state
  const [orderToPrint, setOrderToPrint] = useState<Sale | null>(null);
  const [isOrderDetailsOpen, setIsOrderDetailsOpen] = useState(false);
  const [orderDialogMode, setOrderDialogMode] = useState<OrderDialogMode>('order');

  // Sorting + column visibility
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const handleViewDetails = (sale: Sale, mode: OrderDialogMode) => {
    setOrderToPrint(sale);
    setOrderDialogMode(mode);
    setIsOrderDetailsOpen(true);
  };

  const handleMakeInvoice = (sale: Sale) => {
    makeInvoiceMutation.mutate(sale.id, {
      onSuccess: (data) => {
        if (data.data) {
          setOrderToPrint(data.data);
          setOrderDialogMode('invoice');
          setIsOrderDetailsOpen(true);
        }
      },
    });
  };

  const { table, columns } = useOrdersTable({
    sales, sorting, setSorting, columnVisibility, setColumnVisibility, totalPages,
    onViewDetails: handleViewDetails,
    onEdit: (sale) => { setOrderToEdit(sale); setIsEditOpen(true); },
    onDelete: (id) => setOrderToDelete(id),
    onMakeInvoice: handleMakeInvoice,
    makeDeliveryMutation,
    makeInvoiceMutation,
  });

  return (
    <Card className="printable-area h-full flex flex-col">
      <CardHeader className="non-printable pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sales Orders</CardTitle>
            <CardDescription>Manage and track customer sales orders.</CardDescription>
          </div>
          <OrdersFilterBar
            searchTerm={f.searchTerm}
            onSearchChange={(val) => { f.setSearchTerm(val); f.setCurrentPage(1); }}
            filters={f.filters}
            activeFilterCount={f.activeFilterCount}
            setDialogOpen={f.setDialogOpen}
            handleFilterChange={f.handleFilterChange}
            clearFilters={f.clearFilters}
            table={table}
            salesPersons={salesPersons}
            customers={customers}
          />
        </div>
      </CardHeader>

      <OrdersSummaryCards summary={summary} />

      <CardContent className="flex-1 overflow-hidden">
        <OrdersTable
          table={table}
          columns={columns}
          isLoading={isLoading}
          currentPage={f.currentPage}
          totalPages={totalPages}
          limit={f.limit}
          onLimitChange={(val) => { f.setLimit(val); f.setCurrentPage(1); }}
          onPageChange={(page) => f.handlePageChange(page, totalPages)}
          salesCount={sales.length}
        />
      </CardContent>

      {/* Edit Dialog */}
      <AddSalesOrderDialog
        isOpen={isEditOpen}
        onOpenChange={(open) => { setIsEditOpen(open); if (!open) setOrderToEdit(null); }}
        initialData={orderToEdit || undefined}
        onSuccess={() => { refetch(); setIsEditOpen(false); setOrderToEdit(null); }}
      />

      {/* Delete Alert */}
      <AlertDialog open={!!orderToDelete} onOpenChange={(open) => !open && setOrderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel (delete) the sales order and <strong>automatically reverse the product quantities</strong> back into your inventory. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (orderToDelete) { deleteMutation.mutate(orderToDelete); setOrderToDelete(null); } }}
            >
              Cancel Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Filter Dialogs */}
      <OrdersFilterDialogs
        dialogOpen={f.dialogOpen}
        setDialogOpen={f.setDialogOpen}
        filters={f.filters}
        handleFilterChange={f.handleFilterChange}
        salesPersons={salesPersons}
        customers={customers}
      />

      {/* Order Details Dialog */}
      <OrderDetailsDialog
        order={orderToPrint}
        open={isOrderDetailsOpen}
        mode={orderDialogMode}
        onOpenChange={(open) => { setIsOrderDetailsOpen(open); if (!open) { setOrderToPrint(null); setOrderDialogMode('order'); } }}
      />
    </Card>
  );
}
