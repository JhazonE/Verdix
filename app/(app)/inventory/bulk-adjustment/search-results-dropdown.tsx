import { Loader2, Package, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatQuantity } from '@/lib/utils';
import type { Product } from '@/lib/types';

export function SearchResultsDropdown({
  isLoadingProducts,
  filteredProducts,
  onAdd,
}: {
  isLoadingProducts: boolean;
  filteredProducts: Product[];
  onAdd: (product: Product) => void;
}) {
  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-popover rounded-xl border border-border shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
      {isLoadingProducts ? (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading catalog...</span>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="py-8 text-center">
          <Package className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
          <p className="text-sm font-medium text-muted-foreground">No products found</p>
          <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto divide-y divide-border">
          {filteredProducts.map(p => (
            <button
              key={p.id}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent text-left transition-colors group"
              onMouseDown={(e) => { e.preventDefault(); onAdd(p); }}
            >
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                <Package className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary">{p.name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {p.sellingUnits?.find((su) => su.isBase)?.barcode || p.barcode}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-bold h-5">
                  {formatQuantity(p.stock)} {p.unitOfMeasure}
                </Badge>
                <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Plus className="h-3.5 w-3.5 text-primary" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
