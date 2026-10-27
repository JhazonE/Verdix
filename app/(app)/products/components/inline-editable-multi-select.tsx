'use client';

import { useState } from 'react';
import { PlusCircle, Pencil, Check, X, Loader2, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FormControl } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { InlineEditResult } from './inline-editable-select';

export interface InlineEditableMultiSelectProps<T> {
  items: T[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  addLabel: string;
  emptyLabel: string;
  searchPlaceholder: string;
  getId: (item: T) => string;
  getName: (item: T) => string;
  /** Returns the id of the newly created item, { error } on failure. */
  onAdd: (name: string) => Promise<InlineEditResult>;
  /** Returns the renamed id on success, { error } on failure. */
  onRename: (id: string, name: string) => Promise<InlineEditResult>;
  /**
   * Optional control rendered at the end of a SELECTED row, in place of the
   * rename pencil — for a per-item value the list itself cannot hold, such as
   * an opening stock quantity per warehouse.
   *
   * Omitted by every other caller, so shelf locations and categories render
   * exactly as before. Anything returned here sits inside a CommandItem, whose
   * own keyboard handling would otherwise swallow typing and toggle the row on
   * every click, so the wrapper stops those events — see below.
   */
  renderRowAccessory?: (id: string) => React.ReactNode;
  /**
   * Shows a "Select all / Clear all" toggle above the list.
   *
   * Opt-in, not default: this control is shared with shelf locations and
   * categories, where picking every option at once is rarely meaningful. The
   * Warehouses picker wants it because stocking an item in every location is a
   * normal setup, and ticking them one by one is the tedious part.
   */
  showSelectAll?: boolean;
}

export function InlineEditableMultiSelect<T>({
  items,
  value,
  onChange,
  placeholder,
  addLabel,
  emptyLabel,
  searchPlaceholder,
  getId,
  getName,
  onAdd,
  onRename,
  renderRowAccessory,
  showSelectAll = false,
}: InlineEditableMultiSelectProps<T>) {
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
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
  };

  const toggle = (id: string) => {
    const current = value || [];
    onChange(current.includes(id) ? current.filter((v) => v !== id) : [...current, id]);
  };

  const allIds = items.map(getId);
  const allSelected = allIds.length > 0 && allIds.every((id) => (value || []).includes(id));

  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
      return;
    }
    // Order is load-bearing for the Warehouses picker — the FIRST id is the
    // primary row, the one that owns the scannable barcode. So the existing
    // selection keeps its order and its head, and only the unpicked items are
    // appended. Selecting all must never silently hand the barcode to whatever
    // happens to sort first.
    const current = value || [];
    onChange([...current, ...allIds.filter((id) => !current.includes(id))]);
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
      if (result !== undefined && !(value || []).includes(result)) {
        onChange([...(value || []), result]);
      }
      resetAdd();
    } finally {
      setIsSaving(false);
    }
  };

  const startRename = (item: T) => {
    setRenamingId(getId(item));
    setRenameDraft(getName(item));
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
      resetRename();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Popover>
      <FormControl>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className={cn(
              // min-h-10, not h-10: the box grows when chips wrap onto a
              // second line. py-1.5 (not py-2) keeps a SINGLE row at exactly
              // h-10, so this lines up with the plain h-10 selects beside it —
              // a chip is shorter than a line of text, so matching padding
              // alone would leave this control visibly short.
              'flex min-h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-left font-normal',
              !value?.length && 'text-muted-foreground'
            )}
          >
            {/* gap, not per-badge margins: a trailing mb-1 on every chip
                pushed the content off-centre within the box. */}
            <div className="flex flex-wrap items-center gap-1 pointer-events-none">
              {value && value.length > 0 ? (
                value.map((id) => {
                  const item = items.find((i) => getId(i) === id);
                  return (
                    <Badge variant="secondary" key={id}>
                      {item ? getName(item) : id}
                    </Badge>
                  );
                })
              ) : (
                placeholder
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
      </FormControl>
      <PopoverContent className="w-full min-w-[300px] p-0" align="start">
        <Command className="w-full">
          <CommandInput placeholder={searchPlaceholder} />
          {/* Above the list, not inside it: a row inside CommandList would
              scroll out of reach on a long list and would be filtered away by
              the search box. Outside Command's own item handling too, so it
              never competes with arrow-key navigation. */}
          {showSelectAll && items.length > 0 && (
            <div className="flex items-center justify-between border-b px-2 py-1.5">
              <span className="text-xs text-muted-foreground">
                {(value || []).length} of {items.length} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleAll(); }}
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </Button>
            </div>
          )}
          <CommandList className="max-h-[300px] overflow-y-auto">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => {
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
                const accessory = value?.includes(id)
                  ? renderRowAccessory?.(id)
                  : undefined;

                return (
                  <CommandItem
                    key={id}
                    value={getName(item)}
                    className={cn('relative', accessory ? 'pr-2' : 'pr-9')}
                    onSelect={() => toggle(id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        value?.includes(id) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="flex-1 truncate">{getName(item)}</span>
                    {accessory ? (
                      // The accessory takes the pencil's place on a selected
                      // row: both at once would crowd it, and renaming stays
                      // available by unticking. Every event is stopped here —
                      // CommandItem toggles the row on click and Command
                      // itself steals arrow keys and typing for its search.
                      <span
                        className="ml-2 flex shrink-0 items-center"
                        onPointerDown={stop}
                        onMouseDown={stop}
                        onClick={stop}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {accessory}
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Rename ${getName(item)}`}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); startRename(item); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
