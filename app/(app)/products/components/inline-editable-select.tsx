'use client';

import { useState } from 'react';
import { PlusCircle, Pencil, Check, X, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormControl } from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

// A server action's failure (e.g. a duplicate name) has a human-readable
// `message` worth showing — { error } carries it through so the input
// doesn't just silently close as if nothing happened. Plain `undefined`
// stays valid for a caller with nothing more to say.
export type InlineEditResult = string | undefined | { error: string };

export interface InlineEditableSelectProps<T> {
  items: T[];
  isLoading: boolean;
  value: string;
  onChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  addLabel: string;
  emptyLabel: string;
  loadingLabel?: string;
  orphanLabel?: (value: string) => string;
  getId: (item: T) => string;
  getValue: (item: T) => string;
  getOptionLabel: (item: T) => string;
  getName: (item: T) => string;
  onAdd: (name: string) => Promise<InlineEditResult>;
  onRename: (id: string, name: string) => Promise<InlineEditResult>;
  triggerClassName?: string;
  itemClassName?: string;
  disabled?: boolean;
}

export function InlineEditableSelect<T>({
  items,
  isLoading,
  value,
  onChange,
  open,
  onOpenChange,
  placeholder,
  addLabel,
  emptyLabel,
  loadingLabel = 'Loading...',
  orphanLabel,
  getId,
  getValue,
  getOptionLabel,
  getName,
  onAdd,
  onRename,
  triggerClassName,
  itemClassName,
  disabled,
}: InlineEditableSelectProps<T>) {
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameOldValue, setRenameOldValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const resetAdd = () => {
    setAdding(false);
    setAddDraft('');
  };
  const resetRename = () => {
    setRenamingId(null);
    setRenameDraft('');
    setRenameOldValue('');
  };

  const commitAdd = async () => {
    const name = addDraft.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    try {
      const result = await onAdd(name);
      if (result && typeof result === 'object') {
        toast({ variant: 'destructive', title: 'Could not add', description: result.error });
        return;
      }
      if (result !== undefined) onChange(result);
      resetAdd();
    } finally {
      setIsSaving(false);
    }
  };

  const startRename = (item: T) => {
    setRenamingId(getId(item));
    setRenameDraft(getName(item));
    setRenameOldValue(getValue(item));
    setAdding(false);
  };

  const commitRename = async () => {
    const name = renameDraft.trim();
    if (!name || renamingId === null || isSaving) return;
    setIsSaving(true);
    try {
      const result = await onRename(renamingId, name);
      if (result && typeof result === 'object') {
        toast({ variant: 'destructive', title: 'Could not rename', description: result.error });
        return;
      }
      if (result !== undefined && renameOldValue === value) onChange(result);
      resetRename();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Select
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      // Radix's hidden native <select> re-dispatches a change event when the
      // controlled value changes before the matching <option> has mounted
      // (e.g. right after an inline add); its value reads as '' and would
      // clobber the just-committed selection. Real selections are never ''.
      onValueChange={(v) => { if (v) onChange(v); }}
      value={value}
    >
      <FormControl>
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
      </FormControl>
      <SelectContent>
        {isLoading ? (
          <SelectItem value="loading" disabled className={itemClassName}>{loadingLabel}</SelectItem>
        ) : items.length > 0 ? (
          items.map((item) => {
            const id = getId(item);
            if (renamingId === id) {
              return (
                <div
                  key={id}
                  className="flex items-center gap-1 px-2 py-1"
                  onPointerDown={stop}
                >
                  <Input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        resetRename();
                      }
                    }}
                    className="h-8"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-green-600"
                    disabled={isSaving || !renameDraft.trim()}
                    onClick={(e) => { e.preventDefault(); commitRename(); }}
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    onClick={(e) => { e.preventDefault(); resetRename(); }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            }
            return (
              <div key={id} className="relative">
                <SelectItem value={getValue(item)} className={cn('pr-9', itemClassName)}>
                  {getOptionLabel(item)}
                </SelectItem>
                <button
                  type="button"
                  aria-label={`Rename ${getName(item)}`}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); startRename(item); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        ) : (
          <SelectItem value="none" disabled className={itemClassName}>{emptyLabel}</SelectItem>
        )}

        {!isLoading && orphanLabel && value && !items.some((item) => getValue(item) === value) && (
          <SelectItem value={value} className={itemClassName}>{orphanLabel(value)}</SelectItem>
        )}

        <div className="border-t mt-1 pt-1 px-1">
          {adding ? (
            <div className="flex items-center gap-1 px-1 py-1" onPointerDown={stop}>
              <Input
                autoFocus
                value={addDraft}
                placeholder="New name..."
                onChange={(e) => setAddDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitAdd();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    resetAdd();
                  }
                }}
                className="h-8"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-green-600"
                disabled={isSaving || !addDraft.trim()}
                onClick={(e) => { e.preventDefault(); commitAdd(); }}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={(e) => { e.preventDefault(); resetAdd(); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start h-8 px-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                resetRename();
                setAdding(true);
              }}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              {addLabel}
            </Button>
          )}
        </div>
      </SelectContent>
    </Select>
  );
}
