'use client';

import { UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { InlineWarehouseSelect } from '@/app/(app)/components/inline-selects/inline-warehouse-select';
import { InlinePaymentMethodSelect } from '@/app/(app)/components/inline-selects/inline-payment-method-select';
import { InlineSalesPersonSelect } from '@/app/(app)/components/inline-selects/inline-sales-person-select';
import { CustomerSelectionField } from '../../invoices/customer-selection/customer-selection-field';
import type { SalesOrderFormValues } from './add-order-types';
import type { Customer, PaymentMethod, Warehouse, SalesPerson } from '@/lib/types';

type Props = {
  form: UseFormReturn<SalesOrderFormValues>;
  customers: Customer[];
  refetchCustomers: () => void;
  warehouses: Warehouse[];
  paymentMethods: PaymentMethod[];
  salesPersons: SalesPerson[];
  isReferenceRequired: boolean;
  fetchWarehouses: () => void;
  fetchPaymentMethods: () => void;
  fetchSalesPersons: () => void;
};

export function AddOrderFormHeader({
  form, customers, refetchCustomers,
  warehouses, paymentMethods, salesPersons, isReferenceRequired,
  fetchWarehouses, fetchPaymentMethods, fetchSalesPersons,
}: Props) {
  return (
    <div className="bg-background border-b p-4 grid grid-cols-4 gap-4 shrink-0">

      {/* Column 1: Customer & Address */}
      <div className="space-y-3">
        <CustomerSelectionField
          control={form.control}
          customerList={customers}
          className="bg-background h-8 text-xs"
          onCustomerAdded={refetchCustomers}
          labelClassName="text-xs font-semibold text-muted-foreground"
        />
        <FormField
          control={form.control}
          name="deliveryAddress"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <div className="flex items-center justify-between h-5">
                <FormLabel className="text-xs font-semibold text-muted-foreground">Address</FormLabel>
              </div>
              <FormControl>
                <Input className="h-8 bg-background text-xs" {...field} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>

      {/* Column 2: Dates & Warehouse */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <FormField
            control={form.control}
            name="orderDate"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs font-semibold text-muted-foreground">Order Date</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} placeholder="Order date" />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="deliveryDate"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-xs font-semibold text-muted-foreground">Delivery Date</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} placeholder="Delivery date" clearable />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="warehouse"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <div className="flex items-center h-5">
                <FormLabel className="text-xs font-semibold text-muted-foreground">Warehouse</FormLabel>
              </div>
              <InlineWarehouseSelect
                warehouses={warehouses}
                value={field.value || ''}
                onChange={field.onChange}
                onListChange={fetchWarehouses}
                placeholder="Select warehouse"
                triggerClassName="h-8 bg-background text-xs"
                itemClassName="text-xs"
              />
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
      </div>

      {/* Column 3: Sales Person & Notes */}
      <div className="space-y-3">
        <FormField
          control={form.control}
          name="salesPersonId"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <div className="flex items-center h-5">
                <FormLabel className="text-xs font-semibold text-muted-foreground">Sales Person</FormLabel>
              </div>
              <InlineSalesPersonSelect
                salesPersons={salesPersons}
                value={field.value || ''}
                onChange={field.onChange}
                onListChange={fetchSalesPersons}
                placeholder="Select sales person"
                triggerClassName="h-8 bg-background text-xs"
                itemClassName="text-xs"
              />
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <div className="flex items-center justify-between h-5">
                <FormLabel className="text-xs font-semibold text-muted-foreground">Notes</FormLabel>
              </div>
              <FormControl>
                <Input className="h-8 bg-background text-xs" placeholder="Brief notes..." {...field} value={field.value || ''} />
              </FormControl>
            </FormItem>
          )}
        />
      </div>

      {/* Column 4: Payment Method, Reference & Shipping */}
      <div className="space-y-3">
        <FormField
          control={form.control}
          name="paymentMethod"
          render={({ field }) => (
            <FormItem className="space-y-1">
              <div className="flex items-center h-5">
                <FormLabel className="text-xs font-semibold text-muted-foreground">Payment Method</FormLabel>
              </div>
              <InlinePaymentMethodSelect
                paymentMethods={paymentMethods}
                value={field.value || ''}
                onChange={field.onChange}
                onListChange={fetchPaymentMethods}
                placeholder="Select method"
                triggerClassName="h-8 bg-background text-xs"
                itemClassName="text-xs"
              />
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-2">
          <FormField
            control={form.control}
            name="paymentReference"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <div className="flex items-center justify-between h-5">
                  <FormLabel className="text-xs font-semibold text-muted-foreground">
                    {isReferenceRequired ? <>Ref <span className="text-destructive">*</span></> : 'Ref'}
                  </FormLabel>
                </div>
                <FormControl>
                  <Input
                    className="h-8 bg-background text-xs"
                    placeholder={isReferenceRequired ? 'Req...' : 'Opt...'}
                    {...field}
                    value={field.value || ''}
                  />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="shipping"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <div className="flex items-center justify-between h-5">
                  <FormLabel className="text-xs font-semibold text-muted-foreground">Shipping</FormLabel>
                </div>
                <FormControl>
                  <Input type="number" step="0.01" className="h-8 bg-background text-xs" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </div>

    </div>
  );
}
