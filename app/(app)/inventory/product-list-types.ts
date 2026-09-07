import type { Product } from '@/lib/types';

export interface ProductWithChildren extends Product {
  children?: Product[];
  /** Set when the group only surfaced because a child matched the filter. */
  defaultExpanded?: boolean;
}
