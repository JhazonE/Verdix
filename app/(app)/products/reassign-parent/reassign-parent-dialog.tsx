'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Product } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GitBranch } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { reassignParent } from '../actions';
import { getIllegalReassignTargets, type TreeProduct } from '@/lib/product-tree';
import { buildProductQuery, PRODUCT_SEARCH_DEBOUNCE_MS } from '@/lib/product-search';
import { getApiUrl } from '@/lib/api-config';

const DETACH_VALUE = '__detach__';

export function ReassignParentDialog({
  product,
  products,
  onProductUpdated,
  trigger,
}: {
  product: Product;
  products: Product[];
  onProductUpdated?: () => void;
  trigger?: React.ReactNode;
}) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>('');
  const [factor, setFactor] = useState<string>('');
  const [autoDetectedFrom, setAutoDetectedFrom] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Product[]>(products);
  const [isSearching, setIsSearching] = useState(false);
  const latestRequest = useRef(0);

  // The `products` prop is whatever page the products list happens to be
  // showing (paginated at 10 of ~15,600), so it can never be the source of
  // truth for "which product may become the parent". Search the whole
  // catalogue in SQL instead, the way the transfer/shelf boards do.
  useEffect(() => {
    if (!isOpen) return;
    const requestId = ++latestRequest.current;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(getApiUrl(buildProductQuery(search)));
        const data = await res.json();
        // Ignore a response overtaken by a newer keystroke.
        if (requestId !== latestRequest.current) return;
        if (data.success) setCandidates(data.data);
      } catch {
        if (requestId === latestRequest.current) setCandidates([]);
      } finally {
        if (requestId === latestRequest.current) setIsSearching(false);
      }
    }, PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, isOpen]);

  // Legal targets = every candidate except the child itself and its
  // descendants. This is a convenience filter over the current page of
  // results; reassignParent re-runs the same check server-side against the
  // full table, and that check is the authoritative one.
  const legalTargets = useMemo(() => {
    const treeProducts: TreeProduct[] = candidates.map((p) => ({ id: p.id, parentId: p.parentId }));
    const illegal = getIllegalReassignTargets(product.id, treeProducts);
    illegal.add(product.id);
    return candidates
      .filter((p) => !illegal.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates, product.id]);

  const isDetach = targetId === DETACH_VALUE;
  const canSave = targetId !== '' && (isDetach || (Number(factor) > 0));

  const handleTargetChange = (value: string) => {
    setTargetId(value);
    if (value === DETACH_VALUE) {
      setFactor('');
      setAutoDetectedFrom(null);
      return;
    }
    // Look the parent up among the searched candidates, not the paginated
    // `products` prop — the chosen parent is usually not on that page at all.
    const parent = candidates.find((p) => p.id === value);
    const match = parent?.conversionFactors?.find(
      (cf) => cf.unit === product.unitOfMeasure,
    );
    if (match) {
      setFactor(String(match.factor));
      setAutoDetectedFrom(parent?.name ?? null);
    } else {
      setFactor('');
      setAutoDetectedFrom(null);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const newParentId = isDetach ? null : targetId;
      const result = await reassignParent(product.id, newParentId, isDetach ? 0 : Number(factor));
      if (result.success) {
        toast({ title: 'Reassigned', description: result.message });
        setIsOpen(false);
        setTargetId('');
        setFactor('');
        setSearch('');
        setAutoDetectedFrom(null);
        onProductUpdated?.();
      } else {
        toast({ variant: 'destructive', title: 'Reassignment failed', description: result.message });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className="gap-2">
            <GitBranch className="h-4 w-4" />
            Reassign Parent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign Parent</DialogTitle>
          <DialogDescription>
            Move <span className="font-medium">{product.name}</span> under a different mother product,
            or detach it to become a top-level product.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="reassign-target">New parent</Label>
            <Select value={targetId} onValueChange={handleTargetChange}>
              <SelectTrigger id="reassign-target">
                <SelectValue placeholder="Select a new parent product" />
              </SelectTrigger>
              <SelectContent>
                <div className="p-2">
                  <Input
                    placeholder="Search by name, SKU or barcode..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    // Radix Select steers typing to option-matching; this box
                    // needs the keystrokes itself.
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                {product.parentId && (
                  <SelectItem value={DETACH_VALUE}>Detach (no parent)</SelectItem>
                )}
                {legalTargets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.sku ? (
                      <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span>
                    ) : null}
                  </SelectItem>
                ))}
                {legalTargets.length === 0 && (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {isSearching ? 'Searching...' : 'No matching products.'}
                  </p>
                )}
              </SelectContent>
            </Select>
          </div>

          {!isDetach && targetId !== '' && (
            <div className="space-y-2">
              <Label htmlFor="reassign-factor">
                Conversion factor ({product.unitOfMeasure} per 1 parent unit)
              </Label>
              <Input
                id="reassign-factor"
                type="number"
                step="0.0001"
                min="0"
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
                placeholder="e.g., 12"
              />
              <p className="text-xs text-muted-foreground">
                How many {product.unitOfMeasure} equal one unit of the new parent.
              </p>
              {autoDetectedFrom && (
                <p className="text-xs text-muted-foreground">
                  Auto-detected from {autoDetectedFrom}. You can override it.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? 'Saving...' : 'Reassign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
