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
