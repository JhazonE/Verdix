'use client';

import { useState } from 'react';
import { PlusCircle, Pencil, Check, X, Loader2, ChevronRight } from 'lucide-react';

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
 * One dropdown for both Category and Subcategory, instead of two separate
 * pickers. Categories list as top-level, selectable rows; each category's
 * subcategories are indented directly beneath it, also selectable. Picking
 * either sets both `category`/`subcategory` on the form — a subcategory pick
 * resolves its own parent category automatically, a category pick clears
 * subcategory.
 *
 * Internally, Select values are prefixed ("cat:<id>" / "sub:<id>") so a
 * category and a subcategory can never collide on the same value string;
 * this encoding never leaves the component — onChange always hands back the
 * plain (categoryName, subcategoryName) pair the form actually stores.
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
  const currentValue = subcategoryValue
    ? subcategories.find((s) => s.name === subcategoryValue && s.categoryId === selectedCategory?.id)
      ? `sub:${subcategories.find((s) => s.name === subcategoryValue && s.categoryId === selectedCategory?.id)!.id}`
      : ''
    : selectedCategory
      ? `cat:${selectedCategory.id}`
      : '';

  const displayLabel = subcategoryValue && categoryValue
    ? `${categoryValue} > ${subcategoryValue}`
    : categoryValue || '';

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

  return (
    <Select
      open={open}
      onOpenChange={onOpenChange}
      onValueChange={(v) => {
        if (!v) return;
        if (v.startsWith('cat:')) {
          const id = v.slice(4);
          const c = categories.find((c) => c.id === id);
          if (c) onChange(c.name, '');
        } else if (v.startsWith('sub:')) {
          const id = v.slice(4);
          const s = subcategories.find((s) => s.id === id);
          const c = s ? categories.find((c) => c.id === s.categoryId) : undefined;
          if (s) onChange(c?.name ?? '', s.name);
        }
      }}
      value={currentValue}
    >
      <FormControl>
        <SelectTrigger>
          <SelectValue placeholder="Select a category">{displayLabel || undefined}</SelectValue>
        </SelectTrigger>
      </FormControl>
      <SelectContent className="max-h-96">
        {isLoading ? (
          <SelectItem value="loading" disabled>Loading...</SelectItem>
        ) : categories.length === 0 ? (
          <SelectItem value="none" disabled>No categories found</SelectItem>
        ) : (
          categories.map((c) => {
            const catSubs = subcategories.filter((s) => s.categoryId === c.id);
            const isRenamingThis = renaming?.kind === 'category' && renaming.id === c.id;
            return (
              <div key={c.id}>
                {isRenamingThis ? (
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
                ) : (
                  <div className="relative">
                    <SelectItem value={`cat:${c.id}`} className={cn('pr-9 font-medium')}>
                      {c.name}
                    </SelectItem>
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
                    <div key={s.id} className="flex items-center gap-1 pl-6 pr-2 py-1" onPointerDown={stop}>
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
                  ) : (
                    <div key={s.id} className="relative">
                      <SelectItem value={`sub:${s.id}`} className="pl-6 pr-9">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <ChevronRight className="h-3 w-3" />
                          <span className="text-foreground">{s.name}</span>
                        </span>
                      </SelectItem>
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
                  <div className="flex items-center gap-1 pl-6 pr-2 py-1" onPointerDown={stop}>
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
                    className="w-full flex items-center gap-1 pl-6 pr-2 py-1 h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-sm"
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
              </div>
            );
          })
        )}

        {unassigned.length > 0 && (
          <div className="border-t mt-1 pt-1">
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Unassigned</div>
            {unassigned.map((s) => {
              const isRenamingSub = renaming?.kind === 'subcategory' && renaming.id === s.id;
              return isRenamingSub ? (
                <div key={s.id} className="flex items-center gap-1 pl-6 pr-2 py-1" onPointerDown={stop}>
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
              ) : (
                <div key={s.id} className="relative">
                  <SelectItem value={`sub:${s.id}`} className="pl-6 pr-9 text-muted-foreground">
                    {s.name}
                  </SelectItem>
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
          </div>
        )}

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
      </SelectContent>
    </Select>
  );
}
