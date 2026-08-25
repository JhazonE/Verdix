'use client';

import { memo } from 'react';

import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatCurrency, toSafeNumber } from '@/lib/utils';

// Memoized: the parent re-renders on every search keystroke (typed text is its own
// state, separate from the applied filter), and without memo every row — with its
// own variance math and an input — re-rendered on every keystroke too, which is what
// made the search box feel laggy despite filtering itself being unaffected.
export const CountItemRow = memo(function CountItemRow({
  item,
  isCompleted,
  onChange,
  onEnter,
}: {
  item: any;
  isCompleted: boolean;
  onChange: (id: string, value: string) => void;
  onEnter: () => void;
}) {
  const variance =
    item.counted_quantity !== null ? item.counted_quantity - item.snapshot_quantity : 0;
  // Actual value of what's physically on-hand. Per design, always show the
  // amount even when the count is 0 (null count is treated as 0), so these
  // never blank out.
  const actualQty = toSafeNumber(item.counted_quantity);
  const costAmount = actualQty * toSafeNumber(item.product_cost);
  const retailAmount = actualQty * toSafeNumber(item.product_retail);

  const varianceClass =
    variance < 0 ? 'text-red-500' : variance > 0 ? 'text-green-500' : '';

  return (
    <TableRow>
      <TableCell className="font-medium">{item.product_name}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {item.product_barcode || '-'}
      </TableCell>
      <TableCell className="text-right">{item.snapshot_quantity}</TableCell>
      <TableCell className="text-right">
        {isCompleted ? (
          <span className="font-semibold">{item.counted_quantity ?? '-'}</span>
        ) : (
          <Input
            type="number"
            min="0"
            className="w-24 text-right ml-auto"
            value={item.counted_quantity ?? ''}
            onChange={(e) => onChange(item.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter();
            }}
          />
        )}
      </TableCell>
      <TableCell className="text-right">{formatCurrency(costAmount)}</TableCell>
      <TableCell className="text-right">{formatCurrency(retailAmount)}</TableCell>
      <TableCell className={`text-right font-medium ${varianceClass}`}>
        {item.counted_quantity === null ? '-' : variance > 0 ? `+${variance}` : variance}
      </TableCell>
      <TableCell className={`text-right font-medium ${varianceClass}`}>
        {item.counted_quantity === null
          ? '-'
          : formatCurrency(variance * toSafeNumber(item.product_cost))}
      </TableCell>
    </TableRow>
  );
});
