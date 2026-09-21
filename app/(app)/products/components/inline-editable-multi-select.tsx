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
              'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 h-auto min-h-10 text-left font-normal',
              !value?.length && 'text-muted-foreground'
            )}
          >
            <div className="flex flex-wrap gap-1 pointer-events-none">
              {value && value.length > 0 ? (
                value.map((id) => {
                  const item = items.find((i) => getId(i) === id);
                  return (
                    <Badge variant="secondary" key={id} className="mr-1 mb-1">
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
                return (
                  <CommandItem
                    key={id}
                    value={getName(item)}
                    className="relative pr-9"
                    onSelect={() => toggle(id)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value?.includes(id) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {getName(item)}
                    <button
                      type="button"
                      aria-label={`Rename ${getName(item)}`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); startRename(item); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
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
