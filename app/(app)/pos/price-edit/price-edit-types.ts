import type { SaleItem } from '../pos-content/pos-types';

/** Just enough of a price level for the picker to label and key a choice. */
export interface PriceEditLevel {
  id: string;
  name: string;
}

export interface PriceEditDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  item: SaleItem | null;
  /**
   * `itemId` is the LINE id (`SaleItem.lineId`), not the product id — two
   * lines of the same product on different selling units must be editable
   * independently.
   *
   * `pickedPriceLevelId` is only ever a SET: undefined leaves the line's
   * existing pick alone, so a plain price edit cannot silently clear one.
   */
  onUpdate: (
    itemId: string,
    newName: string,
    newQuantity: number,
    newPrice: number,
    newDiscount: number,
    pickedPriceLevelId?: string,
  ) => void;
  /** All configured levels. Empty disables the picker as surely as the flag. */
  priceLevels: PriceEditLevel[];
  /** The POS Setup toggle. False renders no picker; the dialog still opens. */
  showPriceLevelPicker: boolean;
}
