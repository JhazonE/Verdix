import { formatQuantity } from '@/lib/utils';

// products.stock is always in base units. For a non-base selling unit, show how
// many WHOLE units that stock makes (13 pcs at factor 12 => 1 Case), with the
// base figure underneath so the conversion is visible. Base/unknown units just
// show the plain number.
// Plain-text form of the same conversion, for inline strings like search rows:
// "1 Case (13 pcs)" for a non-base unit, "13" otherwise.
export function formatUnitStockText(stock: number, factor?: number | null, unitName?: string | null): string {
  const f = Number(factor) > 1 ? Number(factor) : 1;
  const base = Number(stock) || 0;
  if (f === 1) return formatQuantity(base);
  const whole = Math.max(0, Math.floor(base / f));
  return `${formatQuantity(whole)}${unitName ? ` ${unitName}` : ''} (${formatQuantity(base)} pcs)`;
}

export function UnitStockView({
  stock,
  factor,
  unitName,
  className,
}: {
  stock: number;
  factor?: number | null;
  unitName?: string | null;
  className?: string;
}) {
  const f = Number(factor) > 1 ? Number(factor) : 1;
  const base = Number(stock) || 0;
  if (f === 1) return <span className={className}>{formatQuantity(base)}</span>;

  const whole = Math.max(0, Math.floor(base / f));
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className={className}>
        {formatQuantity(whole)}
        {unitName ? <span className="ml-1 text-[10px] font-semibold">{unitName}</span> : null}
      </span>
      <span className="text-[10px] font-normal text-muted-foreground">{formatQuantity(base)} pcs</span>
    </span>
  );
}
