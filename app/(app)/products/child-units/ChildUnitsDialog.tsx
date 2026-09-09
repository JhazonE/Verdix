'use client';

import { useState } from 'react';
import { ArrowLeft, PlusCircle } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { formatCurrency, cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { MARKUP_MAX } from '@/lib/markup-validation';
import type { Product } from '@/lib/types';

import { useChildUnits, type ChildUnitRow } from './use-child-units';
import { QuickAddChildDialog } from '../quick-add-child/quick-add-child-dialog';

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
  const { toast } = useToast();
  const [addChildOpen, setAddChildOpen] = useState(false);

  const {
    viewedParent,
    rows,
    rawChildren,
    isLoading,
    refetch,
    inheritedFor,
    suggestedPrice,
    drillInto,
    goBack,
    canGoBack,
    drafts,
    setDraft,
    draftValue,
    isRowValid,
    hasChanges,
    allValid,
    isSaving,
    save,
  } = useChildUnits({ product, open, productOptions });

  // rawChildren carries the category/subcategory/brand/supplier fields that
  // inheritedFor needs but ChildUnitRow doesn't, keyed by id so row order
  // drift (e.g. after a refetch) can't misalign row <-> raw.
  const rawById: Record<string, any> = {};
  for (const r of rawChildren) {
    if (r?.id) rawById[r.id] = r;
  }

  const handleClose = () => {
    if (hasChanges && !window.confirm('Discard unsaved markup changes?')) return;
    onOpenChange(false);
  };

  const handleSave = async () => {
    const result = await save();
    if (result.success) {
      toast({ title: 'Markups Saved', description: result.message });
      onSaved?.();
    } else if (result.message) {
      toast({ variant: 'destructive', title: 'Error Saving Markups', description: result.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : handleClose())}>
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
                    rows.map((row) => (
                      <ChildUnitTableRow
                        key={row.id}
                        row={row}
                        raw={rawById[row.id]}
                        inheritedFor={inheritedFor}
                        suggestedPrice={suggestedPrice}
                        onDrillInto={drillInto}
                        draftText={drafts[row.id]}
                        draftValue={draftValue(row)}
                        isValid={isRowValid(row)}
                        setDraft={setDraft}
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
        <DialogFooter className="sm:justify-between">
          <div>
            <Button variant="outline" onClick={() => setAddChildOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Child Unit
            </Button>
            <QuickAddChildDialog
              parentProduct={viewedParent ?? undefined}
              products={[]}
              open={addChildOpen}
              onOpenChange={setAddChildOpen}
              onChildAdded={() => {
                refetch();
                onSaved?.();
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || !allValid || isSaving}>
              {isSaving ? 'Saving…' : 'Save Markups'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChildUnitTableRow({
  row,
  raw,
  inheritedFor,
  suggestedPrice,
  onDrillInto,
  draftText,
  draftValue,
  isValid,
  setDraft,
}: {
  row: ChildUnitRow;
  raw?: any;
  inheritedFor: (row: ChildUnitRow, raw: any) => { markup: number; source?: string };
  suggestedPrice: (cost: number | undefined, markup: number) => number | undefined;
  onDrillInto: (child: any) => void;
  draftText: string | undefined;
  draftValue: number | null;
  isValid: boolean;
  setDraft: (id: string, text: string) => void;
}) {
  const effective = draftValue === null ? inheritedFor(row, raw).markup : draftValue;
  const suggested = suggestedPrice(row.cost, effective);
  const changed = draftText !== undefined && draftValue !== row.markupPercentage;

  return (
    <TableRow className={cn(changed && 'bg-muted/40')}>
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
      <TableCell>
        <Input
          type="number"
          step="0.01"
          min={0}
          max={MARKUP_MAX}
          className={cn('w-24', !isValid && 'border-destructive')}
          placeholder="inherit"
          value={draftText ?? (row.markupPercentage === null ? '' : String(row.markupPercentage))}
          onChange={(e) => setDraft(row.id, e.target.value)}
        />
        {draftValue === null && (
          <div className="text-xs text-muted-foreground mt-1">
            inherits {inheritedFor(row, raw).markup}%
            {inheritedFor(row, raw).source ? ` (${inheritedFor(row, raw).source})` : ''}
          </div>
        )}
        {!isValid && (
          <div className="text-xs text-destructive mt-1">
            Enter 0–{MARKUP_MAX}, or leave blank to inherit.
          </div>
        )}
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
