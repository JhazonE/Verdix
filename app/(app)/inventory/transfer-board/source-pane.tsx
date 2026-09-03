'use client';

import { Box, Loader2, Rows3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, formatStockQuantity } from '@/lib/utils';
import { ManageWarehousesDialog } from '../../sales/manage-warehouses/ManageWarehousesDialog';

import type { WarehouseStockItem } from './transfer-board-types';

interface SourcePaneProps {
  sourceSearch: string;
  onSearchChange: (value: string) => void;
  filteredSourceItems: WarehouseStockItem[];
  selectedSourceIds: Set<string>;
  onToggleSelectItem: (uniqueId: string) => void;
  onToggleSelectAll: () => void;
  onStageSelected: () => void;
  onStageItem: (uniqueId: string) => void;
  onWarehouseChange: () => void;
  /** A search request is in flight — shown in-place, never as a full remount. */
  isSearching?: boolean;
}

export function SourcePane({
  sourceSearch,
  onSearchChange,
  isSearching,
  filteredSourceItems,
  selectedSourceIds,
  onToggleSelectItem,
  onToggleSelectAll,
  onStageSelected,
  onStageItem,
  onWarehouseChange,
}: SourcePaneProps) {
  const allSelected = filteredSourceItems.length > 0 && selectedSourceIds.size === filteredSourceItems.length;

  return (
    <div className="flex flex-col h-full w-full bg-background min-h-0">
      <div className="p-3 border-b space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-sm flex items-center gap-1.5 truncate">
            <Box className="h-4 w-4" /> Stock Pool
          </h2>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-7 text-[11px] font-bold"
              onClick={onStageSelected}
              disabled={selectedSourceIds.size === 0}
            >
              Stage Selected
            </Button>
            <ManageWarehousesDialog
              onChange={onWarehouseChange}
              trigger={
                <Button variant="outline" size="sm" className="h-7 px-1.5">
                  <Rows3 className="h-4 w-4" />
                </Button>
              }
            />
          </div>
        </div>
        {/* Search progress shows as a small spinner inside the field rather
            than replacing the board, so the input keeps focus and the list
            never flickers while typing. */}
        <div className="relative">
          <Input
            placeholder="Search name, SKU or barcode..."
            value={sourceSearch}
            onChange={e => onSearchChange(e.target.value)}
            className="h-8 text-sm pr-8"
          />
          {isSearching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-[36px,1fr,56px] px-3 py-1 bg-muted/30 border-b text-[10px] font-bold text-muted-foreground uppercase">
        <div className="flex justify-center">
          <Checkbox checked={allSelected} onCheckedChange={onToggleSelectAll} />
        </div>
        <span>Product</span>
        <span className="text-right">Stock</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-1">
          {filteredSourceItems.map(item => (
            <div
              key={item.uniqueId}
              className={cn(
                "grid grid-cols-[36px,1fr,60px] items-center gap-2 p-2 rounded-lg border",
                selectedSourceIds.has(item.uniqueId) ? "bg-primary/5 border-primary" : "bg-card"
              )}
            >
              <div className="flex justify-center">
                <Checkbox
                  checked={selectedSourceIds.has(item.uniqueId)}
                  onCheckedChange={() => onToggleSelectItem(item.uniqueId)}
                />
              </div>
              <div className="min-w-0 cursor-pointer" onClick={() => onStageItem(item.uniqueId)}>
                <p className="text-xs font-bold truncate leading-tight">{item.product.name}</p>
                <div className="flex items-center gap-1.5 opacity-70">
                  <Badge variant="outline" className="text-[9px] px-1 h-3.5 truncate max-w-[80px]">
                    {item.warehouseName}
                  </Badge>
                  <span className="text-[9px] truncate font-mono">{item.product.sku}</span>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-1.5 text-xs font-black"
                  onClick={e => { e.stopPropagation(); onStageItem(item.uniqueId); }}
                >
                  {formatStockQuantity(item.quantity)}
                </Button>
              </div>
            </div>
          ))}
          {filteredSourceItems.length === 0 && (
            <div className="py-20 text-center text-xs text-muted-foreground opacity-50">No products found</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
