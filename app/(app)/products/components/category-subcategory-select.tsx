'use client';

import { useState } from 'react';
import { PlusCircle, Pencil, Check, X, Loader2, ChevronRight, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormControl } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { Category } from '@/lib/types';

type Subcategory = Category & { categoryId: string | null };

export interface CategorySubcategorySelectProps {
  categories: Category[];
  subcategories: Subcategory[];
  isLoading: boolean;
  /** The product form's current `category` value (a name, not an id). */
  categoryValue: string;
  /** The product form's current `subcategory` value (a name, not an id). */
  subcategoryValue: string;
  /** Fires with the resolved (categoryName, subcategoryName) pair for whichever row was picked. */
  onChange: (categoryName: string, subcategoryName: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddCategory: (name: string) => Promise<string | undefined>;
  onRenameCategory: (id: string, name: string) => Promise<string | undefined>;
  onAddSubcategory: (name: string, categoryId: string) => Promise<string | undefined>;
  onRenameSubcategory: (id: string, name: string) => Promise<string | undefined>;
}

/**
 * One searchable dropdown for both Category and Subcategory, instead of two
 * separate pickers. Categories list as top-level, selectable rows; each
 * category's subcategories are indented directly beneath it, also
 * selectable. Picking either sets both `category`/`subcategory` on the
 * form — a subcategory pick resolves its own parent category automatically,
 * a category pick clears subcategory.
 *
 * Built on Popover+Command (cmdk), not Radix's <Select>, specifically for
 * the search box: cmdk filters items against the typed query as you type,
 * matching the pattern InlineEditableMultiSelect already uses elsewhere in
 * this codebase — Select has no equivalent built-in filtering mechanism.
 *
 * Each CommandItem's `value` is its display name (what cmdk's default
 * filter matches against); its `key`/select-handler carry the real
 * category/subcategory id separately, since two different subcategories in
 * different categories can share a name (see the migration that made
 * subcategory names unique only within their own category, not globally).
 */
export function CategorySubcategorySelect({
  categories,
  subcategories,
  isLoading,
  categoryValue,
  subcategoryValue,
  onChange,
  open,
  onOpenChange,
  onAddCategory,
  onRenameCategory,
  onAddSubcategory,
  onRenameSubcategory,
}: CategorySubcategorySelectProps) {
  const [addingUnderCategoryId, setAddingUnderCategoryId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [renaming, setRenaming] = useState<{ kind: 'category' | 'subcategory'; id: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const resetAdd = () => {
    setAddingUnderCategoryId(null);
    setAddingCategory(false);
    setAddDraft('');
  };
  const resetRename = () => {
    setRenaming(null);
    setRenameDraft('');
  };

  const selectedCategory = categories.find((c) => c.name === categoryValue);
  const selectedSubcategory = subcategoryValue
    ? subcategories.find((s) => s.name === subcategoryValue && s.categoryId === selectedCategory?.id)
    : undefined;

  const displayLabel = subcategoryValue && categoryValue
    ? `${categoryValue} > ${subcategoryValue}`
    : categoryValue || '';

  const selectCategory = (c: Category) => {
    onChange(c.name, '');
    onOpenChange(false);
  };
  const selectSubcategory = (s: Subcategory) => {
    const c = categories.find((c) => c.id === s.categoryId);
    onChange(c?.name ?? '', s.name);
    onOpenChange(false);
  };

  const commitAddCategory = async () => {
    const name = addDraft.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    try {
      const newName = await onAddCategory(name);
      if (newName !== undefined) onChange(newName, '');
      resetAdd();
    } finally {
      setIsSaving(false);
    }
  };

  const commitAddSubcategory = async (categoryId: string, categoryName: string) => {
    const name = addDraft.trim();
    if (!name || isSaving) return;
    setIsSaving(true);
    try {
      const newName = await onAddSubcategory(name, categoryId);
      if (newName !== undefined) onChange(categoryName, newName);
      resetAdd();
    } finally {
      setIsSaving(false);
    }
  };

  const startRenameCategory = (c: Category) => {
    setRenaming({ kind: 'category', id: c.id });
    setRenameDraft(c.name);
    resetAdd();
  };
  const startRenameSubcategory = (s: Subcategory) => {
    setRenaming({ kind: 'subcategory', id: s.id });
    setRenameDraft(s.name);
    resetAdd();
  };

  const commitRename = async () => {
    const name = renameDraft.trim();
    if (!name || !renaming || isSaving) return;
    setIsSaving(true);
    try {
      if (renaming.kind === 'category') {
        const wasSelected = categoryValue === categories.find((c) => c.id === renaming.id)?.name;
        const newName = await onRenameCategory(renaming.id, name);
        if (newName !== undefined && wasSelected) onChange(newName, subcategoryValue);
      } else {
        const sub = subcategories.find((s) => s.id === renaming.id);
        const wasSelected = subcategoryValue === sub?.name;
        const newName = await onRenameSubcategory(renaming.id, name);
        if (newName !== undefined && wasSelected) onChange(categoryValue, newName);
      }
      resetRename();
    } finally {
      setIsSaving(false);
    }
  };

  const unassigned = subcategories.filter((s) => !s.categoryId);

  const renameRow = (
    <div className="flex items-center gap-1 px-2 py-1" onPointerDown={stop}>
      <Input
        autoFocus
        value={renameDraft}
        onChange={(e) => setRenameDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
          else if (e.key === 'Escape') { e.preventDefault(); resetRename(); }
        }}
        className="h-8"
      />
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-green-600"
        disabled={isSaving || !renameDraft.trim()}
        onClick={(e) => { e.preventDefault(); commitRename(); }}>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground"
        onClick={(e) => { e.preventDefault(); resetRename(); }}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <FormControl>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className={cn(
              'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm font-normal ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              !displayLabel && 'text-muted-foreground'
            )}
          >
            <span className="line-clamp-1 text-left">{displayLabel || 'Select a category'}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
      </FormControl>
      <PopoverContent
        className="w-full min-w-[320px] p-0 flex flex-col"
        style={{ maxHeight: 'var(--radix-popover-content-available-height)' }}
        align="start"
      >
        {/* When the trigger sits low enough on screen that Radix flips this
            popover to open upward, its available height above the trigger
            can be less than CommandList's own max-h — without capping the
            whole popover (not just the list) to Radix's own
            --radix-popover-content-available-height, the popover overflows
            past the top of the viewport and clips CommandInput, the first
            child, right out of view. min-h-0 lets the flex child (Command)
            actually shrink instead of just overflowing its flex parent. */}
        <Command className="min-h-0">
          <CommandInput placeholder="Search categories..." />
          <CommandList className="max-h-96">
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
            ) : categories.length === 0 ? (
              <CommandEmpty>No categories found</CommandEmpty>
            ) : (
              <>
                <CommandEmpty>No matches found</CommandEmpty>
                {categories.map((c) => {
                  const catSubs = subcategories.filter((s) => s.categoryId === c.id);
                  const isRenamingThis = renaming?.kind === 'category' && renaming.id === c.id;
                  return (
                    <CommandGroup key={c.id}>
                      {isRenamingThis ? renameRow : (
                        <div className="relative">
                          <CommandItem
                            value={c.name}
                            // The category row stays visible (and its group
                            // open) whenever the search matches ANY of its
                            // subcategories, not just its own name — without
                            // this, typing "Phones" would hide "Electronics"
                            // and its "Phones" child would lose its visual
                            // parent context.
                            keywords={catSubs.map((s) => s.name)}
                            className="pr-9 font-medium"
                            onSelect={() => selectCategory(c)}
                          >
                            <Check className={cn('mr-2 h-4 w-4', selectedCategory?.id === c.id && !selectedSubcategory ? 'opacity-100' : 'opacity-0')} />
                            {c.name}
                          </CommandItem>
                          <button
                            type="button"
                            aria-label={`Rename ${c.name}`}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); startRenameCategory(c); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {catSubs.map((s) => {
                        const isRenamingSub = renaming?.kind === 'subcategory' && renaming.id === s.id;
                        return isRenamingSub ? (
                          <div key={s.id} className="pl-6">{renameRow}</div>
                        ) : (
                          <div key={s.id} className="relative">
                            <CommandItem
                              value={s.name}
                              className="pl-8 pr-9"
                              onSelect={() => selectSubcategory(s)}
                            >
                              <Check className={cn('mr-2 h-4 w-4', selectedSubcategory?.id === s.id ? 'opacity-100' : 'opacity-0')} />
                              <ChevronRight className="mr-1 h-3 w-3 text-muted-foreground" />
                              {s.name}
                            </CommandItem>
                            <button
                              type="button"
                              aria-label={`Rename ${s.name}`}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); startRenameSubcategory(s); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}

                      {addingUnderCategoryId === c.id ? (
                        <div className="flex items-center gap-1 pl-8 pr-2 py-1" onPointerDown={stop}>
                          <Input
                            autoFocus
                            value={addDraft}
                            placeholder="New subcategory..."
                            onChange={(e) => setAddDraft(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') { e.preventDefault(); commitAddSubcategory(c.id, c.name); }
                              else if (e.key === 'Escape') { e.preventDefault(); resetAdd(); }
                            }}
                            className="h-8"
                          />
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-green-600"
                            disabled={isSaving || !addDraft.trim()}
                            onClick={(e) => { e.preventDefault(); commitAddSubcategory(c.id, c.name); }}>
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground"
                            onClick={(e) => { e.preventDefault(); resetAdd(); }}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="w-full flex items-center gap-1 pl-8 pr-2 py-1 h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-sm"
                          onPointerDown={stop}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            resetRename();
                            setAddingCategory(false);
                            setAddingUnderCategoryId(c.id);
                          }}
                        >
                          <PlusCircle className="h-3 w-3" />
                          Add Subcategory
                        </button>
                      )}
                    </CommandGroup>
                  );
                })}

                {unassigned.length > 0 && (
                  <CommandGroup heading="Unassigned">
                    {unassigned.map((s) => {
                      const isRenamingSub = renaming?.kind === 'subcategory' && renaming.id === s.id;
                      return isRenamingSub ? (
                        <div key={s.id} className="pl-6">{renameRow}</div>
                      ) : (
                        <div key={s.id} className="relative">
                          <CommandItem
                            value={s.name}
                            className="pl-8 pr-9 text-muted-foreground"
                            onSelect={() => selectSubcategory(s)}
                          >
                            <Check className={cn('mr-2 h-4 w-4', selectedSubcategory?.id === s.id ? 'opacity-100' : 'opacity-0')} />
                            {s.name}
                          </CommandItem>
                          <button
                            type="button"
                            aria-label={`Rename ${s.name}`}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); startRenameSubcategory(s); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>

          <div className="border-t mt-1 pt-1 px-1">
            {addingCategory ? (
              <div className="flex items-center gap-1 px-1 py-1" onPointerDown={stop}>
                <Input
                  autoFocus
                  value={addDraft}
                  placeholder="New category..."
                  onChange={(e) => setAddDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') { e.preventDefault(); commitAddCategory(); }
                    else if (e.key === 'Escape') { e.preventDefault(); resetAdd(); }
                  }}
                  className="h-8"
                />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-green-600"
                  disabled={isSaving || !addDraft.trim()}
                  onClick={(e) => { e.preventDefault(); commitAddCategory(); }}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground"
                  onClick={(e) => { e.preventDefault(); resetAdd(); }}>
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
                  setAddingUnderCategoryId(null);
                  setAddingCategory(true);
                }}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Category
              </Button>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
