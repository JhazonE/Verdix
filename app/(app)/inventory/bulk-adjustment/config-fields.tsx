import { Tag } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Supplier, Warehouse } from '@/lib/types';

import { typeConfig, type AdjustmentType } from './constants';

export function ConfigFields({
  compact = false,
  adjustmentType,
  onChangeType,
  warehouseId,
  setWarehouseId,
  targetWarehouseId,
  setTargetWarehouseId,
  warehouses,
  referenceNo,
  setReferenceNo,
  suppliers,
  supplierId,
  setSupplierId,
  note,
  setNote,
  showExpirationColumn,
  applyExpirationToAll,
}: {
  compact?: boolean;
  adjustmentType: AdjustmentType;
  onChangeType: (type: AdjustmentType) => void;
  warehouseId: string;
  setWarehouseId: (value: string) => void;
  targetWarehouseId: string;
  setTargetWarehouseId: (value: string) => void;
  warehouses: Warehouse[];
  referenceNo: string;
  setReferenceNo: (value: string) => void;
  suppliers: Supplier[];
  supplierId: string;
  setSupplierId: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  showExpirationColumn?: boolean;
  applyExpirationToAll?: (date: string) => void;
}) {
  return (
    <div className={cn("space-y-5", compact && "space-y-4")}>
      {/* Adjustment Type */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Adjustment Mode</Label>
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-muted rounded-xl">
          {(['add', 'remove', 'transfer'] as const).map(type => {
            const cfg = typeConfig[type];
            const Icon = cfg.icon;
            const isActive = adjustmentType === type;
            return (
              <button
                key={type}
                onClick={() => onChangeType(type)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all",
                  isActive ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className={cn("h-4 w-4", isActive && (type === 'add' ? 'text-emerald-600' : type === 'remove' ? 'text-red-600' : 'text-blue-600'))} />
                {type === 'add' ? 'Add' : type === 'remove' ? 'Remove' : 'Transfer'}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">Applies to all items in the batch</p>
      </div>

      {/* Warehouse */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {adjustmentType === 'transfer' ? 'Source Warehouse' : 'Warehouse'}
        </Label>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="All warehouses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">All Warehouses</SelectItem>
            {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Transfer Destination */}
      {adjustmentType === 'transfer' && (
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400">Destination Warehouse</Label>
          <Select value={targetWarehouseId} onValueChange={setTargetWarehouseId}>
            <SelectTrigger className="h-10 border-blue-200 bg-blue-50/50 ring-1 ring-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:ring-blue-500/20">
              <SelectValue placeholder="Select destination" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.filter(w => w.id !== warehouseId).map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Reference No */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Reference No.</Label>
        <div className="relative">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="e.g. ADJ-10023"
            className="pl-9 h-10"
            value={referenceNo}
            onChange={e => setReferenceNo(e.target.value)}
          />
        </div>
      </div>

      {/* Supplier */}
      {suppliers.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Supplier (optional)</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="None / External" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Memo */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Memo / Reason</Label>
        <Textarea
          placeholder="Reason for this batch adjustment..."
          className="min-h-[90px] resize-none text-sm"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>

      {showExpirationColumn && (
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase text-muted-foreground">
            Expiry For All Perishables
          </label>
          <Input
            type="date"
            className="h-9"
            onChange={e => applyExpirationToAll?.(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">
            Sets this date on every perishable item in the batch.
          </p>
        </div>
      )}
    </div>
  );
}
