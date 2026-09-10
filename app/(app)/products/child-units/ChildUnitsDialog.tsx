'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronDown, MoreVertical, PlusCircle } from 'lucide-react';

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatCurrency, cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { Product } from '@/lib/types';

import { useChildUnits, type ChildUnitRow } from './use-child-units';
import { QuickAddChildDialog } from '../quick-add-child/quick-add-child-dialog';
import { AddExistingChildDialog } from './AddExistingChildDialog';
import { reassignParent } from '../actions';

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
  const [addExistingOpen, setAddExistingOpen] = useState(false);

  const {
    viewedParent,
    rows,
    rawChildren,
    isLoading,
    refetch,
    drillInto,
    goBack,
    canGoBack,
    drafts,
    setDraft,
    draftValue,
    isRowValid,
    unitCounts,
    isSaving,
    save,
  } = useChildUnits({ product, open, productOptions });

  // rawChildren carries fields ChildUnitRow doesn't (e.g. conversionFactors,
  // used by the move picker), keyed by id so row order drift (e.g. after a
  // refetch) can't misalign row <-> raw.
  const rawById: Record<string, any> = {};
  for (const r of rawChildren) {
    if (r?.id) rawById[r.id] = r;
  }

  // Row being moved (opens the move picker) / removed (opens the confirm).
  // Holding the raw child record, not just an id, because the move picker
  // needs a full Product-shaped `subject` (unitOfMeasure, conversionFactors).
  const [moveTarget, setMoveTarget] = useState<any | null>(null);
  const [removeTarget, setRemoveTarget] = useState<any | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const afterRowAction = () => {
    refetch();
    onSaved?.();
  };

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return;
    setIsRemoving(true);
    try {
      const result = await reassignParent(removeTarget.id, null, 0);
      if (result.success) {
        toast({ title: 'Removed', description: result.message });
        afterRowAction();
        setRemoveTarget(null);
      } else {
        toast({ variant: 'destructive', title: 'Could not remove', description: result.message });
      }
    } finally {
      setIsRemoving(false);
    }
  };

  const hasEdits = Object.keys(drafts).length > 0;
  const handleClose = () => {
    if (hasEdits && !window.confirm('Discard unsaved conversion changes?')) return;
    onOpenChange(false);
  };

  const handleSave = async () => {
    const result = await save();
    if (result.message) {
      toast({
        variant: result.success ? undefined : 'destructive',
        title: result.success ? 'Conversions Saved' : 'Error Saving Conversions',
        description: result.message,
      });
    }
    if (result.success) {
      onSaved?.();
      onOpenChange(false);
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
                    <TableHead className="text-right">Current Price</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading &&
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7} className="h-12 text-center text-muted-foreground">
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
                        onDrillInto={drillInto}
                        drafts={drafts}
                        draftValue={draftValue(row)}
                        isValid={isRowValid(row)}
                        unitCounts={unitCounts}
                        setDraft={setDraft}
                        onMove={() => setMoveTarget(rawById[row.id] ?? row)}
                        onRemove={() => setRemoveTarget(rawById[row.id] ?? row)}
                      />
                    ))}
                  {!isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                        No child units yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground mt-2">
            Changing a conversion factor affects future stock syncs only — it does not
            adjust quantities already recorded.
          </p>
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <PlusCircle className="mr-2 h-4 w-4" /> Add Child Unit
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setAddChildOpen(true)}>
                  Create new
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!viewedParent}
                  onClick={() => setAddExistingOpen(true)}
                >
                  Add existing product
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
            {viewedParent && (
              <AddExistingChildDialog
                subject={viewedParent}
                mode="add"
                open={addExistingOpen}
                onOpenChange={setAddExistingOpen}
                onAdded={() => {
                  refetch();
                  onSaved?.();
                }}
              />
            )}
            {moveTarget && (
              <AddExistingChildDialog
                subject={moveTarget}
                mode="move"
                open={!!moveTarget}
                onOpenChange={(next) => {
                  if (!next) setMoveTarget(null);
                }}
                onAdded={afterRowAction}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save Conversions'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={!!removeTarget} onOpenChange={(next) => !next && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.name} from this family?</AlertDialogTitle>
            <AlertDialogDescription>It becomes a top-level product.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveConfirm} disabled={isRemoving}>
              {isRemoving ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function ChildUnitTableRow({
  row,
  raw,
  onDrillInto,
  drafts,
  draftValue,
  isValid,
  unitCounts,
  setDraft,
  onMove,
  onRemove,
}: {
  row: ChildUnitRow;
  raw?: any;
  onDrillInto: (child: any) => void;
  drafts: Record<string, string>;
  draftValue: number | null;
  isValid: boolean;
  unitCounts: Map<string, number>;
  setDraft: (unit: string, text: string) => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const unit = row.unitOfMeasure ?? '';
  const draftText = drafts[unit];
  const changed = draftText !== undefined && draftValue !== (row.conversionFactor ?? null);

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
      <TableCell className="text-center">
        {row.unitOfMeasure ? (
          <>
            <Input
              type="number"
              step="0.01"
              min={0}
              className={cn('w-24 mx-auto text-center', !isValid && 'border-destructive')}
              placeholder="none"
              value={
                drafts[row.unitOfMeasure ?? ''] ??
                (row.conversionFactor === null || row.conversionFactor === undefined
                  ? ''
                  : String(row.conversionFactor))
              }
              onChange={(e) => setDraft(row.unitOfMeasure ?? '', e.target.value)}
            />
            {(unitCounts.get(row.unitOfMeasure ?? '') ?? 0) > 1 && (
              <div className="text-xs text-muted-foreground mt-1">
                shared with {(unitCounts.get(row.unitOfMeasure ?? '') ?? 1) - 1} other unit
              </div>
            )}
            {!isValid && (
              <div className="text-xs text-destructive mt-1">
                Enter a number greater than 0, or leave it blank.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-center">—</div>
            <div className="text-xs text-muted-foreground mt-1">
              No unit set — a conversion factor is keyed by the child&apos;s unit, so it can&apos;t be set until this product has one.
            </div>
          </>
        )}
      </TableCell>
      <TableCell className="text-center">{row.stock ?? '—'}</TableCell>
      <TableCell className="text-right">
        {typeof row.cost === 'number' ? formatCurrency(row.cost) : '—'}
      </TableCell>
      <TableCell className="text-right">
        {typeof row.price === 'number' ? formatCurrency(row.price) : '—'}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onMove}>Move to another parent</DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove}>Remove from family</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
