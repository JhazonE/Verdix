'use client';

import { ArrowLeft } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/lib/types';

import { useChildUnits, type ChildUnitRow } from './use-child-units';

export function ChildUnitsDialog({
  product,
  open,
  onOpenChange,
  productOptions,
  onSaved,
}: {
  product?: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productOptions?: any;
  onSaved?: () => void;
}) {
  const {
    viewedParent,
    rows,
    rawChildren,
    isLoading,
    suggestedPrice,
    drillInto,
    goBack,
    canGoBack,
  } = useChildUnits({ product, open, productOptions });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl !rounded-3xl !duration-500 ease-in-out data-[state=open]:!animate-in data-[state=closed]:!animate-out data-[state=closed]:!fade-out-0 data-[state=open]:!fade-in-0 data-[state=closed]:!zoom-out-95 data-[state=open]:!zoom-in-90 data-[state=closed]:!slide-out-to-top-[5%] data-[state=open]:!slide-in-from-top-[5%]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {canGoBack && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={goBack}
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>
              Manage Child Units{viewedParent?.name ? ` — ${viewedParent.name}` : ''}
            </DialogTitle>
          </div>
          <DialogDescription>
            {viewedParent
              ? `${viewedParent.unitOfMeasure ?? 'unit'} · Cost ${typeof viewedParent.cost === 'number' ? formatCurrency(viewedParent.cost) : '—'}`
              : 'Direct child units for this product.'}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-center">Conversion</TableHead>
                    <TableHead className="text-center">Stock</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-center">Markup %</TableHead>
                    <TableHead className="text-right">Suggested</TableHead>
                    <TableHead className="text-right">Current Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8} className="h-12 text-center text-muted-foreground">
                          Loading…
                        </TableCell>
                      </TableRow>
                    ))}
                  {!isLoading &&
                    rows.map((row, idx) => (
                      <ChildUnitTableRow
                        key={row.id}
                        row={row}
                        raw={rawChildren[idx]}
                        suggestedPrice={suggestedPrice}
                        onDrillInto={drillInto}
                      />
                    ))}
                  {!isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                        No child units yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChildUnitTableRow({
  row,
  raw,
  suggestedPrice,
  onDrillInto,
}: {
  row: ChildUnitRow;
  raw?: any;
  suggestedPrice: (cost: number | undefined, markup: number) => number | undefined;
  onDrillInto: (child: any) => void;
}) {
  // Suggested price only makes sense for a markup that actually resolves to a
  // number. A saved override (markupPercentage !== null) is used as-is; Task 8
  // will add showing the inherited hint when it's null.
  const suggested =
    row.markupPercentage !== null ? suggestedPrice(row.cost, row.markupPercentage) : undefined;

  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          <span>{row.name}</span>
          {row.childCount > 0 && (
            <Badge
              variant="secondary"
              className="cursor-pointer"
              onClick={() => onDrillInto(raw ?? { id: row.id, name: row.name })}
            >
              {row.childCount} children
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>{row.unitOfMeasure ?? '—'}</TableCell>
      <TableCell className="text-center">{row.conversionFactor ?? '—'}</TableCell>
      <TableCell className="text-center">{row.stock ?? '—'}</TableCell>
      <TableCell className="text-right">
        {typeof row.cost === 'number' ? formatCurrency(row.cost) : '—'}
      </TableCell>
      <TableCell className="text-center">
        {row.markupPercentage === null ? '—' : row.markupPercentage}
      </TableCell>
      <TableCell className="text-right">
        {typeof suggested === 'number' ? formatCurrency(suggested) : '—'}
      </TableCell>
      <TableCell className="text-right">
        {typeof row.price === 'number' ? formatCurrency(row.price) : '—'}
      </TableCell>
    </TableRow>
  );
}
