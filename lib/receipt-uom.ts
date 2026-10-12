/**
 * Shared by both the thermal (ESC/POS) and on-screen receipts, so a unit
 * reads the same abbreviation everywhere a receipt shows it — the on-screen
 * copy isn't fixed-width like the thermal one, but keeping them consistent
 * is what makes them recognizably the same document. Kept dependency-free
 * so a client component can import it without pulling in the printer
 * encoder that lib/receipt-generator.ts also carries.
 */
export function abbreviateUOM(uom?: string): string {
  if (!uom) return '';
  const map: Record<string, string> = {
    'Pieces': 'pcs',
    'Piece': 'pc',
    'Kilograms': 'kg',
    'Kilogram': 'kg',
    'Kilos': 'kg',
    'Kilo': 'kg',
    'Grams': 'g',
    'Gram': 'g',
    'Meters': 'm',
    'Meter': 'm',
    'Liters': 'L',
    'Liter': 'L',
    'Boxes': 'bx',
    'Box': 'bx',
    'Case': 'cs',
    'Cases': 'cs',
    'Pack': 'pk',
    'Packs': 'pk',
    'Bottle': 'btl',
    'Bottles': 'btl',
    'Can': 'cn',
    'Cans': 'cn',
    'Milliliters': 'ml',
    'Milliliter': 'ml'
  };
  const trimmed = uom.trim();
  const upper = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return map[upper] || trimmed.toLowerCase();
}

type ReceiptLineLike = {
  quantity: number;
  unitOfMeasure?: string;
  selectedSellingUnit?: { name: string; factor: number; isBase?: boolean };
  sellingUnits?: { name: string; isBase?: boolean }[];
};

/**
 * What a receipt line shows in its Qty column. A line sold as a non-base unit
 * (1 Case of 12) reads in base units ("12 pcs") with the unit it was sold as
 * as an equivalence ("1 cs"), matching the POS cart. Price and amount stay
 * per sold unit, so the equivalence is what ties 12 to the price shown.
 */
export function receiptLineQuantity(item: ReceiptLineLike): {
  qty: number;
  uom: string;
  soldAs?: { qty: number; uom: string };
} {
  const unit = item.selectedSellingUnit;
  if (!unit || unit.isBase || !(unit.factor > 1)) {
    return { qty: item.quantity, uom: abbreviateUOM(unit?.name ?? item.unitOfMeasure) };
  }
  const baseName = item.sellingUnits?.find((u) => u.isBase)?.name ?? item.unitOfMeasure;
  return {
    qty: Number((item.quantity * unit.factor).toFixed(4)),
    uom: abbreviateUOM(baseName),
    soldAs: { qty: item.quantity, uom: abbreviateUOM(unit.name) },
  };
}
