'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn, toSafeNumber } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { dispatchStockUpdate } from '@/hooks/use-live-refresh';
import { PrintPreviewDialog } from './print-preview-dialog';
import { ApprovalsHistoryDialog } from './approvals-history-dialog';
import {
  ClipboardCheck,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Search,
  History,
  AlertCircle,
  RefreshCcw,
  Printer,
  FileText,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApprovalItem {
  id: string;
  transaction_type: string;
  transaction_data: any;
  status: 'Pending' | 'Approved' | 'Rejected';
  current_step: number;
  created_by: string;
  requester_name: string;
  requester_email: string;
  created_at: string;
  updated_at: string;
  currentStepRole: string;
  currentStepRoleId: string | null;
  history: any[];
  workflow: any[];
}

interface ApprovalsKanbanProps {
  open?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { val: 'ALL',              lab: 'All' },
  { val: 'STOCK_ADJUSTMENT', lab: 'Adjust' },
  { val: 'PURCHASE_ORDER',   lab: 'POs' },
  { val: 'STOCK_TRANSFER',   lab: 'Transfers' },
  { val: 'RECEIVE_PO',       lab: 'Receive' },
  { val: 'BAD_ORDER',        lab: 'Bad Order' },
  { val: 'STOCK_COUNT',      lab: 'Counts' },
  { val: 'REPACKAGING',      lab: 'Repack' },
  { val: 'SHELF_TRANSFER',   lab: 'Shelf' },
  { val: 'PRODUCT_CREATE',   lab: 'Add Product' },
  { val: 'PRICE_UPDATE',     lab: 'Price Update' },
];

function typeStyle(type: string, reason?: string) {
  if (type === 'STOCK_ADJUSTMENT' && reason === 'Physical Count') return 'bg-indigo-100 text-indigo-800 border-indigo-200';
  
  switch (type) {
    case 'STOCK_ADJUSTMENT': return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'STOCK_TRANSFER':   return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'PURCHASE_ORDER':   return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'RECEIVE_PO':       return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'BAD_ORDER':        return 'bg-red-100 text-red-800 border-red-200';
    case 'STOCK_COUNT':      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    case 'REPACKAGING':      return 'bg-teal-100 text-teal-800 border-teal-200';
    case 'SHELF_TRANSFER':   return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'PRODUCT_CREATE':   return 'bg-green-100 text-green-800 border-green-200';
    case 'PRICE_UPDATE':     return 'bg-pink-100 text-pink-800 border-pink-200';
    default:                 return 'bg-secondary/50 text-muted-foreground';
  }
}

function cardTitle(item: ApprovalItem): string {
  const d = item.transaction_data || {};
  switch (item.transaction_type) {
    case 'STOCK_TRANSFER':   return `Transfer → ${d.toWarehouseName || 'Target'}`;
    case 'PURCHASE_ORDER':   return `PO: ${d.supplierName || 'Supplier'}`;
    case 'RECEIVE_PO':       return `Receive PO #${d.reference_number || d.id || '—'}`;
    case 'STOCK_ADJUSTMENT': 
      if (d.reason === 'Physical Count') return `Physical Count: ${d.productName || '—'}`;
      return `Adjustment: ${d.productName || '—'}`;
    case 'BAD_ORDER':        
      if (d.productName && d.productName !== 'Unknown') return `Bad Order: ${d.productName}`;
      if (d.items && d.items.length > 0) {
        const first = d.items[0].productName || 'Unknown';
        return `Bad Order: ${first}${d.items.length > 1 ? ` (+${d.items.length - 1} more)` : ''}`;
      }
      return 'Bad Order: Batch';
    case 'STOCK_COUNT':      return `Stock Count: ${d.warehouseName || '—'}`;
    case 'REPACKAGING':      return `Repackaging: ${d.sourceProductName || d.productName || '—'}`;
    case 'PRODUCT_CREATE':   return `Add Product: ${d.name || d.productName || '—'}`;
    case 'PRICE_UPDATE':
      if (d.items && d.items.length > 0) {
        const first = d.items[0].productName || 'Unknown';
        return `Price Update: ${first}${d.items.length > 1 ? ` (+${d.items.length - 1} more)` : ''}`;
      }
      return 'Price Update: Batch';
    case 'SHELF_TRANSFER':
      if (d.productName && d.productName !== 'Unknown') return `Shelf Transfer: ${d.productName}`;
      if (d.items && d.items.length > 0) {
        const first = d.items[0].productName || 'Unknown';
        return `Shelf Transfer: ${first}${d.items.length > 1 ? ` (+${d.items.length - 1} more)` : ''}`;
      }
      return 'Shelf Transfer: Batch';
    default:                 return item.transaction_type.replace(/_/g, ' ');
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ApprovalCard({
  item,
  active,
  onClick,
}: {
  item: ApprovalItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cn(
        'w-full text-left px-5 py-4 border-b cursor-pointer transition-all duration-200',
        'border-l-4 relative',
        active
          ? 'bg-primary/5 border-l-primary'
          : 'border-l-transparent hover:bg-secondary/20',
      )}
    >
      {/* Type badge + ID */}
      <div className="flex items-center justify-between mb-1.5">
        <Badge
          variant="outline"
          className={cn(
            'text-[9px] uppercase font-black px-2 h-5 tracking-tighter border-transparent',
            typeStyle(item.transaction_type, item.transaction_data?.reason),
          )}
        >
          {item.transaction_type === 'STOCK_ADJUSTMENT' && item.transaction_data?.reason === 'Physical Count' 
            ? 'PHYSICAL COUNT' 
            : item.transaction_type.replace(/_/g, ' ')}
        </Badge>
        <span className="text-[10px] font-mono text-muted-foreground/50">
          #{item.id.slice(-8)}
        </span>
      </div>

      {/* Title + requester */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm font-bold leading-tight truncate mb-0.5',
              active ? 'text-primary' : 'text-foreground',
            )}
          >
            {cardTitle(item)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {item.requester_name || 'System'}
          </p>
        </div>

        {/* Status / Step */}
        <div className="text-right shrink-0">
          {item.status === 'Pending' ? (
            <>
              <p className="text-[9px] uppercase text-muted-foreground/40 font-bold">Step</p>
              <p className="text-[11px] font-black text-primary uppercase leading-none">
                {item.currentStepRole}
              </p>
            </>
          ) : (
            <Badge
              variant="secondary"
              className={cn(
                'text-[8px] font-black uppercase',
                item.status === 'Approved'
                  ? 'text-green-700 bg-green-50'
                  : 'text-red-700 bg-red-50',
              )}
            >
              {item.status}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 opacity-25 text-center select-none">
      <Icon className="h-14 w-14 mb-3" />
      <p className="text-xs font-black uppercase tracking-widest">{label}</p>
    </div>
  );
}

function TransactionDetails({ item }: { item: ApprovalItem }) {
  const d = item.transaction_data || {};
  const type = item.transaction_type.toUpperCase();

  const Row = ({ label, value }: { label: string; value: any }) => (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-dashed border-border/40 last:border-0">
      <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground shrink-0 w-32">{label}</span>
      <span className="text-sm font-semibold text-right break-all">{value ?? '—'}</span>
    </div>
  );

  const ItemsTable = ({ items, cols }: { items: any[]; cols: { key: string; label: string; right?: boolean }[] }) => (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/30">
            {cols.map(c => (
              <th key={c.key} className={cn('px-3 py-2 text-[9px] font-black uppercase tracking-wider text-muted-foreground', c.right && 'text-right')}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={cols.length} className="px-3 py-4 text-center text-xs text-muted-foreground">No items</td></tr>
          ) : items.map((it: any, idx: number) => (
            <tr key={idx} className="border-t border-border/30">
              {cols.map(c => (
                <td key={c.key} className={cn('px-3 py-2 text-[11px]', c.right && 'text-right font-mono')}>{it[c.key] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <FileText className="size-4 text-primary" /> Transaction Details
      </h4>

      {/* PURCHASE ORDER */}
      {type === 'PURCHASE_ORDER' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="Supplier" value={d.supplierName} />
            <Row label="PO Reference" value={d.reference_number || d.referenceNumber || d.reference} />
            <Row label="Warehouse" value={d.warehouseName || d.receiveToWarehouseName} />
            <Row label="Grand Total" value={d.total || d.grandTotal ? `₱${Number(d.total || d.grandTotal).toLocaleString()}` : '—'} />
          </div>
          <ItemsTable
            items={d.items || []}
            cols={[
              { key: 'productName', label: 'Product' },
              { key: 'productBarcode', label: 'Barcode' },
              { key: 'productSku', label: 'SKU' },
              { key: 'quantity', label: 'Qty', right: true },
              { key: 'cost', label: 'Unit Cost', right: true },
            ]}
          />
        </>
      )}

      {/* RECEIVE PO */}
      {type === 'RECEIVE_PO' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="Supplier" value={d.supplierName} />
            <Row label="PO Reference" value={d.reference || d.referenceNumber || d.id || d.purchaseOrderId} />
            <Row label="Warehouse" value={d.warehouseName || d.receiveToWarehouseName} />
            <Row label="Total Received" value={d.receivedTotal || d.total ? `₱${Number(d.receivedTotal || d.total).toLocaleString()}` : '—'} />
          </div>
          <ItemsTable
            items={d.receivedItems || d.items || []}
            cols={[
              { key: 'productName', label: 'Product' },
              { key: 'productBarcode', label: 'Barcode' },
              { key: 'productSku', label: 'SKU' },
              { key: 'quantity', label: 'Qty', right: true },
              { key: 'cost', label: 'Unit Cost', right: true },
            ]}
          />
        </>
      )}

      {/* STOCK ADJUSTMENT */}
      {type === 'STOCK_ADJUSTMENT' && (
        <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
          <Row label="Product" value={d.productName || d.name} />
          <Row label="Barcode" value={d.productBarcode || d.barcode || '—'} />
          <Row label="Warehouse" value={d.warehouseName || d.warehouse || '—'} />
          <Row label="Shelf" value={d.shelfName || d.shelf || '—'} />
          <Row label="Change (Qty)" value={`${Number(d.quantity) > 0 ? '+' : ''}${d.quantity}`} />
          <Row label="Previous Stock" value={d.currentStock} />
          <Row label="New Stock" value={d.currentStock != null ? Number(d.currentStock) + Number(d.quantity || 0) : '—'} />
          <Row label="Reason" value={d.reason} />
        </div>
      )}

      {/* STOCK TRANSFER */}
      {type === 'STOCK_TRANSFER' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="From" value={d.fromWarehouseName || d.sourceWarehouseId} />
            <Row label="To" value={d.toWarehouseName || d.targetWarehouseId} />
            {!d.items && <Row label="Product" value={d.productName} />}
            {!d.items && <Row label="Barcode" value={d.productBarcode || d.barcode || '—'} />}
            {!d.items && <Row label="SKU" value={d.productSku || d.sku || '—'} />}
            {!d.items && <Row label="Quantity" value={d.quantity} />}
          </div>
          {d.items && d.items.length > 0 && (
            <ItemsTable
              items={d.items}
              cols={[
                { key: 'productName', label: 'Product' },
                { key: 'productBarcode', label: 'Barcode' },
                { key: 'productSku', label: 'SKU' },
                { key: 'quantity', label: 'Qty', right: true },
              ]}
            />
          )}
        </>
      )}

      {/* STOCK COUNT */}
      {type === 'STOCK_COUNT' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="Count Name" value={d.name} />
            <Row label="Warehouse" value={d.warehouseName || 'All Warehouses'} />
            <Row label="Shelf" value={d.shelfName || 'All Shelves'} />
            <Row label="Total Items" value={(d.items || []).length || '—'} />
          </div>
          <ItemsTable
            items={(d.items || []).map((it: any) => ({
              ...it,
              variance: it.counted_quantity != null
                ? (it.counted_quantity - it.snapshot_quantity > 0
                    ? `+${it.counted_quantity - it.snapshot_quantity}`
                    : String(it.counted_quantity - it.snapshot_quantity))
                : '—',
              counted_quantity: it.counted_quantity != null ? it.counted_quantity : '—',
            }))}
            cols={[
              { key: 'productName', label: 'Product' },
              { key: 'productSku', label: 'SKU' },
              { key: 'snapshot_quantity', label: 'Expected', right: true },
              { key: 'counted_quantity', label: 'Counted', right: true },
              { key: 'variance', label: 'Variance', right: true },
            ]}
          />
        </>
      )}

      {/* BAD ORDER */}
      {type === 'BAD_ORDER' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="Supplier" value={d.supplierName || 'N/A'} />
            <Row label="Reported By" value={d.reportedBy} />
            <Row label="Warehouse" value={d.warehouseName} />
            <Row label="Shelf / Area" value={d.shelfName} />
            <Row label="Total Lost Value" value={`₱${toSafeNumber(d.totalAffectedValue || d.total || (d.items?.reduce((acc: number, item: any) => acc + (toSafeNumber(item.cost) * toSafeNumber(item.quantity)), 0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            {d.notes && <Row label="Notes" value={d.notes} />}
          </div>
          <ItemsTable
            items={d.items || []}
            cols={[
              { key: 'productName', label: 'Product' },
              { key: 'productBarcode', label: 'Barcode' },
              { key: 'quantity', label: 'Qty', right: true },
              { key: 'reason', label: 'Reason' },
              { key: 'cost', label: 'Cost', right: true },
            ]}
          />
        </>
      )}

      {/* REPACKAGING */}
      {type === 'REPACKAGING' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="Source Product" value={d.sourceProductName || d.productName} />
            <Row label="Target Product" value={d.targetProductName} />
            <Row label="Quantity" value={d.quantity || d.quantityToBreak || d.packQtyUsed || '—'} />
            <Row label="Warehouse" value={d.warehouseName || '—'} />
            <Row label="Reason" value={d.reason || (d.quantityToBreak ? 'Break Pack' : d.packQtyUsed ? 'Consolidate Pack' : 'Repackaging')} />
          </div>
          {d.items && d.items.length > 0 && (
            <ItemsTable
              items={d.items}
              cols={[
                { key: 'productName', label: 'Product' },
                { key: 'barcode', label: 'Barcode' },
                { key: 'sku', label: 'SKU' },
                { key: 'quantity', label: 'Qty', right: true },
                { key: 'unit', label: 'Unit' },
              ]}
            />
          )}
        </>
      )}

      {/* SHELF_TRANSFER */}
      {type === 'SHELF_TRANSFER' && (
        <>
          {(d.items || d.updates) ? (
            <>
              {/* Header summarized block for batch transfers if applicable */}
              <div className="bg-secondary/10 rounded-2xl p-4 space-y-0 mb-4">
                 <Row label="Transfer Type" value="Batch Shelf Transfer" />
                 <Row label="Items Count" value={(d.items || d.updates).length} />
                 {/* If single product in batch */}
                 {d.items?.[0]?.productName && d.items.length === 1 && <Row label="Product" value={d.items[0].productName} />}
              </div>
              <ItemsTable
                items={d.items || d.updates.map((u: any) => ({ 
                  ...u, 
                  sourceShelfName: u.sourceShelfName || u.sourceShelf || 'Unassigned', 
                  targetShelfName: u.targetShelfName || u.targetShelf || 'Unassigned' 
                }))} 
                cols={[
                  { key: 'productName', label: 'Product' },
                  { key: 'barcode', label: 'Barcode' },
                  { key: 'sourceShelfName', label: 'From' },
                  { key: 'targetShelfName', label: 'To' },
                  { key: 'quantity', label: 'Qty', right: true },
                ]}
              />
            </>
          ) : (
            <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
              <Row label="Product" value={d.productName || d.name} />
              <Row label="Barcode" value={d.barcode || d.productBarcode} />
              <Row label="From Shelf" value={d.fromShelfName || d.fromShelf || d.sourceShelf || 'Unassigned'} />
              <Row label="To Shelf" value={d.toShelfName || d.toShelf || d.targetShelf || 'Unassigned'} />
              <Row label="Quantity" value={d.quantity} />
            </div>
          )}
        </>
      )}
      {/* PRICE_UPDATE */}
      {type === 'PRICE_UPDATE' && (
        <>
          <div className="bg-secondary/10 rounded-2xl p-4 space-y-0">
            <Row label="Products Affected" value={(d.items || []).length} />
            <Row label="Warehouse" value={d.warehouseName || d.warehouseId || '—'} />
          </div>
          <ItemsTable
            items={(d.items || []).map((it: any) => ({
              ...it,
              fieldLabel: it.field === 'priceLevel' ? (it.priceLevelName || 'Price Level') : it.field === 'cost' ? 'Cost' : 'Selling Price',
              oldValueFmt: `₱${toSafeNumber(it.oldValue).toFixed(2)}`,
              newValueFmt: `₱${toSafeNumber(it.newValue).toFixed(2)}`,
            }))}
            cols={[
              { key: 'productName', label: 'Product' },
              { key: 'sku', label: 'SKU' },
              { key: 'fieldLabel', label: 'Field' },
              { key: 'oldValueFmt', label: 'Old', right: true },
              { key: 'newValueFmt', label: 'New', right: true },
            ]}
          />
        </>
      )}
      {/* Generic fallback for anything else that has .items */}
      {!['PURCHASE_ORDER','RECEIVE_PO','STOCK_ADJUSTMENT','STOCK_TRANSFER','STOCK_COUNT','BAD_ORDER','REPACKAGING','SHELF_TRANSFER','PRICE_UPDATE'].includes(type) && d.items && (
        <ItemsTable
          items={d.items}
          cols={[
            { key: 'productName', label: 'Item' },
            { key: 'quantity', label: 'Qty', right: true },
          ]}
        />
      )}
    </div>
  );
}

function DetailView({
  item,
  onClose,
  onPrint,
  user,
  isProcessing,
  onAction,
}: {
  item: ApprovalItem;
  onClose: () => void;
  onPrint: () => void;
  user: any;
  isProcessing: boolean;
  onAction: (action: 'Approve' | 'Reject', notes: string) => void;
}) {
  const isMobile = useIsMobile();
  const [notes, setNotes] = useState('');

  const canAct = useMemo(() => {
    if (!item || !user || item.status !== 'Pending') return false;
    const isAdmin = user.userType === 'Admin' || user.userType === 'Super Admin' || user.username === 'admin';
    if (isAdmin) return true;
    const byId   = user.roleId   && String(user.roleId)   === String(item.currentStepRoleId);
    const byName = user.userType && String(user.userType) === String(item.currentStepRole);
    return !!(byId || byName);
  }, [item, user]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b shrink-0 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        {isMobile && (
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full -ml-2">
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-black tracking-tight truncate">
            {item.transaction_type === 'STOCK_ADJUSTMENT' && item.transaction_data?.reason === 'Physical Count' 
              ? 'PHYSICAL COUNT' 
              : item.transaction_type.replace(/_/g, ' ')}
          </h2>
          <p className="text-[10px] text-muted-foreground font-mono">ID: {item.id}</p>
        </div>
        {/* Print button — always visible */}
        <Button
          variant="outline"
          size="sm"
          onClick={onPrint}
          className="gap-1.5 rounded-full font-bold text-xs"
        >
          <Printer className="size-4" />
          {!isMobile && 'Print'}
        </Button>
        {!isMobile && (
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full opacity-40 hover:opacity-100">
            <XCircle className="size-5" />
          </Button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6 space-y-8 pb-48">
        {/* Requester card */}
        <div className="flex items-center gap-4 bg-primary/5 p-5 rounded-3xl border border-primary/10">
          <div className="size-14 rounded-2xl bg-primary text-white flex items-center justify-center text-2xl font-black shadow-md flex-shrink-0">
            {(item.requester_name || 'S').charAt(0)}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase text-primary/60 tracking-widest mb-0.5">Initiated by</p>
            <p className="text-lg font-black">{item.requester_name || 'System'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{new Date(item.created_at).toLocaleString()}</p>
          </div>
        </div>

        {/* Transaction Details */}
        <TransactionDetails item={item} />

        {/* Workflow timeline */}
        <div className="space-y-4">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <History className="size-4 text-primary" /> Approval Progress
          </h4>
          <div className="relative pl-10 space-y-6 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
            {/* Start node */}
            <div className="relative">
              <div className="absolute -left-[38px] top-0 size-8 rounded-full bg-green-500 text-white flex items-center justify-center z-10 border-4 border-background shadow">
                <CheckCircle2 className="size-4" />
              </div>
              <div className="bg-secondary/20 p-4 rounded-2xl border">
                <p className="text-[10px] font-black uppercase text-green-600 tracking-wider">Start</p>
                <p className="text-sm font-bold">Transaction Created</p>
              </div>
            </div>

            {/* Dynamic steps */}
            {(item.workflow || []).map((step: any, idx: number) => {
              const isCurrent = step.step_order === item.current_step && item.status === 'Pending';
              const isPast = step.step_order < item.current_step ||
                (step.step_order === item.current_step && item.status !== 'Pending');
              return (
                <div key={idx} className="relative">
                  <div className={cn(
                    'absolute -left-[38px] top-0 size-8 rounded-full flex items-center justify-center z-10 border-4 border-background shadow',
                    isPast ? 'bg-green-500 text-white' : isCurrent ? 'bg-primary text-white animate-pulse' : 'bg-secondary text-muted-foreground',
                  )}>
                    {isPast ? <CheckCircle2 className="size-4" /> : isCurrent ? <Clock className="size-4" /> : <div className="size-2 rounded-full bg-current opacity-30" />}
                  </div>
                  <div className={cn('p-4 rounded-2xl border transition-all', isCurrent ? 'bg-primary/5 border-primary/20 shadow-sm' : 'bg-secondary/10 border-border/40 opacity-60')}>
                    <p className={cn('text-[10px] font-black uppercase tracking-wider', isCurrent ? 'text-primary' : 'text-muted-foreground')}>{step.role_name}</p>
                    <p className="text-sm font-bold">Level {step.step_order} Approval</p>
                    {isCurrent && <p className="text-[11px] text-primary/70 font-semibold mt-1">Awaiting action…</p>}
                  </div>
                </div>
              );
            })}

            {/* End node */}
            <div className="relative">
              <div className={cn(
                'absolute -left-[38px] top-0 size-8 rounded-full flex items-center justify-center z-10 border-4 border-background shadow',
                item.status === 'Approved' ? 'bg-green-500 text-white' : item.status === 'Rejected' ? 'bg-red-500 text-white' : 'bg-secondary text-muted-foreground opacity-40',
              )}>
                {item.status === 'Approved' ? <CheckCircle2 className="size-4" /> : item.status === 'Rejected' ? <XCircle className="size-4" /> : <div className="size-2 rounded-full bg-current" />}
              </div>
              <div className="bg-secondary/20 p-4 rounded-2xl border opacity-50">
                <p className="text-[10px] font-black uppercase text-muted-foreground">Final</p>
                <p className="text-sm font-bold">
                  {item.status === 'Approved' ? 'Transaction Committed' : item.status === 'Rejected' ? 'Transaction Rejected' : 'Pending Final Decision'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Notes textarea */}
        {item.status === 'Pending' && (
          <div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes (optional)…"
              className="w-full min-h-[100px] bg-secondary/30 rounded-3xl border-none p-5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/30"
            />
          </div>
        )}
      </div>

      {/* Action bar */}
      {item.status === 'Pending' && (
        <div className="absolute bottom-0 left-0 right-0 px-6 py-5 border-t bg-background/90 backdrop-blur-xl z-20">
          {!canAct && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-4">
              <AlertCircle className="size-4 text-amber-600 shrink-0" />
              <p className="text-[11px] font-semibold text-amber-800 leading-snug">
                Only <span className="font-black">{item.currentStepRole}</span> can approve this step.
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <Button
              disabled={isProcessing || !canAct}
              variant="outline"
              className="flex-1 h-12 rounded-full border-2 text-red-600 border-red-200 hover:bg-red-50 font-black uppercase tracking-wide disabled:opacity-30"
              onClick={() => onAction('Reject', notes)}
            >
              Reject
            </Button>
            <Button
              disabled={isProcessing || !canAct}
              className="flex-[2] h-12 rounded-full font-black uppercase tracking-wide shadow-lg shadow-primary/20 disabled:opacity-30"
              onClick={() => onAction('Approve', notes)}
            >
              {isProcessing ? 'Processing…' : 'Approve'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ApprovalsKanban({ open }: ApprovalsKanbanProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ApprovalItem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('ALL');
  const [activeTab, setActiveTab] = useState('actions');
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchQueue = async () => {
    try {
      setIsLoading(true);
      const qRes = await fetch('/api/approvals/queue?status=ALL');
      if (!qRes.ok) {
        const errData = await qRes.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${qRes.status}`);
      }
      const qData = await qRes.json();
      if (qData.success) {
        setItems(qData.data);
      } else {
        throw new Error(qData.error || 'Failed to load approvals');
      }
    } catch (err: any) {
      console.error('Failed to fetch approval queue:', err);
      toast({ title: 'Failed to load approvals', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open === undefined || open === true) fetchQueue();
  }, [open]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('mock-user-session');
      if (raw) setUser(JSON.parse(raw));
    } catch {}
  }, []);

  // ── Derived data ───────────────────────────────────────────────────────────

  const canAction = (item: ApprovalItem) => {
    if (!user || item.status !== 'Pending') return false;
    const isAdmin = user.userType === 'Admin' || user.userType === 'Super Admin' || user.username === 'admin';
    if (isAdmin) return true;
    const byId   = user.roleId   && String(user.roleId)   === String(item.currentStepRoleId);
    const byName = user.userType && String(user.userType) === String(item.currentStepRole);
    return !!(byId || byName);
  };

  const filtered = useMemo(() => {
    let res = items;
    if (selectedType !== 'ALL') {
      if (selectedType === 'STOCK_COUNT') {
        res = res.filter((i) => 
          i.transaction_type === 'STOCK_COUNT' || 
          (i.transaction_type === 'STOCK_ADJUSTMENT' && i.transaction_data?.reason === 'Physical Count')
        );
      } else if (selectedType === 'STOCK_ADJUSTMENT') {
        res = res.filter((i) => 
          i.transaction_type === 'STOCK_ADJUSTMENT' && i.transaction_data?.reason !== 'Physical Count'
        );
      } else {
        res = res.filter((i) => i.transaction_type === selectedType);
      }
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      res = res.filter(
        (i) =>
          i.transaction_type.toLowerCase().includes(q) ||
          (i.requester_name || '').toLowerCase().includes(q) ||
          i.id.includes(searchTerm),
      );
    }
    return res;
  }, [items, selectedType, searchTerm]);

  const toAction     = filtered.filter(canAction);
  const inProgress   = filtered.filter((i) => i.status === 'Pending' && !canAction(i));
  const history      = filtered.filter((i) => i.status !== 'Pending').slice(0, 50);

  // ── Approval action ─────────────────────────────────────────────────────────

  const processApproval = async (id: string, action: 'Approve' | 'Reject', notes: string) => {
    if (!user) return;
    setIsProcessing(true);
    try {
      const res = await fetch('/api/approvals/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: id, action, userId: user.uid, notes }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: action === 'Approve' ? 'Approved ✓' : 'Rejected', description: data.status });
        setSelectedItem(null);
        fetchQueue();
        dispatchStockUpdate();
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to process', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  // ── List renderer helper ────────────────────────────────────────────────────

  const renderList = (list: ApprovalItem[], emptyIcon: any, emptyLabel: string) => {
    if (isLoading) {
      return Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-4 py-3">
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ));
    }
    if (list.length === 0) return <EmptyState icon={emptyIcon} label={emptyLabel} />;
    return list.map((item) => (
      <ApprovalCard
        key={item.id}
        item={item}
        active={selectedItem?.id === item.id}
        onClick={() => setSelectedItem(item)}
      />
    ));
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  // On mobile: show either the list OR the detail, never both
  const showList   = !isMobile || !selectedItem;
  const showDetail = !isMobile || !!selectedItem;

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* ── Master List ── */}
      {showList && (
        <div
          className={cn(
            'flex flex-col h-full border-r bg-background overflow-hidden',
            isMobile ? 'w-full' : 'w-[400px] shrink-0',
          )}
        >
          {/* Sticky header */}
          <div className="px-5 pt-5 pb-4 border-b bg-background/90 backdrop-blur-sm shrink-0 space-y-3">
            {/* Title row */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight">Inbox</h2>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
                  Approval Center
                </p>
              </div>
              <Button
                onClick={fetchQueue}
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full bg-secondary/50"
              >
                <RefreshCcw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              </Button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search transactions…"
                className="pl-10 h-11 bg-secondary/20 border-none rounded-2xl text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Type filter chips — scrollable with fade hint */}
            <div className="relative">
              <div className="overflow-x-auto scrollbar-hide">
                <div className="flex gap-2 w-max pr-8">
                  {TYPE_FILTERS.map((t) => (
                    <button
                      key={t.val}
                      onClick={() => setSelectedType(t.val)}
                      className={cn(
                        'shrink-0 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all',
                        selectedType === t.val
                          ? 'bg-primary text-white shadow-md shadow-primary/20'
                          : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/70',
                      )}
                    >
                      {t.lab}
                    </button>
                  ))}
                </div>
              </div>
              {/* Fade-edge scroll hint */}
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-background to-transparent" />
            </div>
          </div>

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col flex-1 min-h-0 overflow-hidden"
          >
            <div className="px-4 pt-3 pb-2 shrink-0">
              <TabsList className="w-full bg-secondary/30 p-1 h-12 rounded-2xl border">
                <TabsTrigger
                  value="actions"
                  className="flex-1 text-[10px] font-black uppercase tracking-widest rounded-xl gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow"
                >
                  To Action
                  {toAction.length > 0 && (
                    <span className="flex items-center justify-center h-4 min-w-[16px] px-1 bg-primary text-white text-[9px] rounded-full font-black">
                      {toAction.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="pending"
                  className="flex-1 text-[10px] font-black uppercase tracking-widest rounded-xl data-[state=active]:bg-background data-[state=active]:shadow"
                >
                  In Progress
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  className="flex-1 text-[10px] font-black uppercase tracking-widest rounded-xl data-[state=active]:bg-background data-[state=active]:shadow"
                >
                  History
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden relative">
              <TabsContent
                value="actions"
                className="absolute inset-0 m-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden"
              >
                {renderList(toAction, CheckCircle2, 'Inbox Zero')}
              </TabsContent>

              <TabsContent
                value="pending"
                className="absolute inset-0 m-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden"
              >
                {renderList(inProgress, Clock, 'No pending items')}
              </TabsContent>

              <TabsContent
                value="history"
                className="absolute inset-0 m-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden"
              >
                {renderList(history, ClipboardCheck, 'No history yet')}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}

      {/* ── Detail Panel ── */}
      {showDetail && (
        <div className={cn('flex-1 h-full relative overflow-hidden bg-background')}>
          {selectedItem ? (
            <DetailView
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onPrint={() => setShowPrintPreview(true)}
              user={user}
              isProcessing={isProcessing}
              onAction={(action, notes) => processApproval(selectedItem.id, action, notes)}
            />
          ) : (
            /* Desktop empty state */
            <div className="flex flex-col items-center justify-center h-full text-center px-8 opacity-40 select-none">
              <ClipboardCheck className="h-16 w-16 mb-4" />
              <h3 className="text-xl font-black">Select a transaction</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Pick an item from the inbox to review and act on it.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <PrintPreviewDialog
        item={selectedItem}
        open={showPrintPreview}
        onOpenChange={setShowPrintPreview}
      />
      <ApprovalsHistoryDialog
        items={items}
        open={showHistoryDialog}
        onOpenChange={setShowHistoryDialog}
        onViewDetails={(item) => {
          setSelectedItem(item);
          setShowHistoryDialog(false);
        }}
      />
    </div>
  );
}
