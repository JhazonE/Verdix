import type { Product } from '@/lib/types';

export interface ProductSearchDialogProps {
  onSelectProduct: (product: Product, explicitUnitId?: string) => void;
  children?: React.ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  showQuantityInSearch?: boolean;
  activeLevelId?: string;
  defaultLevelId?: string;
  activeLevelName?: string;
  warehouseId?: string;
  allProducts?: Product[];
}
