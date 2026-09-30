'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { splitIntoUnits, sumToBase, type QuantityUnit } from '@/lib/unit-quantity';

const unitKey = (u: QuantityUnit) => u.id ?? u.name;

/**
 * Count entry for a product with more than one selling unit: one box per unit
 * (2 Case + 5 Piece). The boxes are summed to base units and reported through
 * `onChange` as the same string the single-box input would send, so everything
 * downstream (save, completion, variance) keeps working in base units.
 *
 * The per-unit text lives here rather than being re-derived from the base total
 * on every keystroke: typing "30" into Piece would otherwise instantly
 * renormalise itself into "1 Case + 6 Piece" under the counter's fingers.
 */
export function UnitCountInput({
  itemId,
  units,
  countedQuantity,
  onChange,
  onEnter,
  className,
  inputClassName,
  stopClickPropagation,
}: {
  itemId: string;
  units: QuantityUnit[];
  countedQuantity: number | null;
  onChange: (id: string, value: string) => void;
  onEnter: () => void;
  className?: string;
  inputClassName?: string;
  stopClickPropagation?: boolean;
}) {
  const ordered = [...units].sort((a, b) => b.factor - a.factor);

  const [entries, setEntries] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (countedQuantity !== null) {
      for (const e of splitIntoUnits(countedQuantity, ordered)) {
        initial[unitKey(e.unit)] = String(e.quantity);
      }
    }
    return initial;
  });

  const handleUnitChange = (unitId: string, value: string) => {
    const next = { ...entries, [unitId]: value };
    setEntries(next);

    const filled = ordered.filter((u) => (next[unitKey(u)] ?? '') !== '');
    if (filled.length === 0) {
      onChange(itemId, '');
      return;
    }
    const total = sumToBase(
      filled.map((unit) => ({ unit, quantity: Number(next[unitKey(unit)]) || 0 }))
    );
    onChange(itemId, String(Number(total.toFixed(4))));
  };

  return (
    <div className={cn('flex items-center gap-2 justify-end', className)}>
      {ordered.map((unit) => (
        <label key={unitKey(unit)} className="flex items-center gap-1 text-xs text-muted-foreground">
          <Input
            type="number"
            min="0"
            aria-label={`${unit.name} count`}
            className={cn('w-16 text-right', inputClassName)}
            value={entries[unitKey(unit)] ?? ''}
            onChange={(e) => handleUnitChange(unitKey(unit), e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter();
            }}
            onClick={stopClickPropagation ? (e) => e.stopPropagation() : undefined}
            placeholder="0"
          />
          {unit.name}
        </label>
      ))}
    </div>
  );
}
