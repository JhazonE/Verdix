'use client';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Scissors, Package, ArrowRight, Search, PlusCircle, Link2, CheckCircle2, ChevronLeft, Info } from 'lucide-react';
import { cn, formatQuantity } from '@/lib/utils';

import { useBreakPack } from './use-break-pack';

export function BreakPackDialog({ parentProduct, onPackBroken, trigger }: {
  parentProduct: Product,
  onPackBroken: () => void,
  trigger?: React.ReactNode
}) {
  const {
    isOpen,
    setIsOpen,
    step,
    setStep,
    isBreaking,
    quantityToBreak,
    setQuantityToBreak,
    targetMode,
    setTargetMode,
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedTarget,
    setSelectedTarget,
    isSearching,
    newName,
    setNewName,
    newUnit,
    setNewUnit,
    newPrice,
    setNewPrice,
    packsProduced,
    setPacksProduced,
    handleFinish,
  } = useBreakPack({ parentProduct, onPackBroken });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger ? trigger : (
          <Button variant="outline" className="gap-2">
            <Scissors className="h-4 w-4" />
            Repackage
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-primary" />
            Repackage / Convert
          </DialogTitle>
          <DialogDescription>
            Systematic workflow to convert stock into another product.
          </DialogDescription>
        </DialogHeader>

        {/* Mini Progress Tracker */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/30 rounded-lg mb-4">
          {[
            { id: 'source', label: 'Source' },
            { id: 'target', label: 'Destination' },
            { id: 'count', label: 'Output' }
          ].map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className={cn(
                "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider",
                step === s.id ? "text-primary" : "text-muted-foreground/60"
              )}>
                <div className={cn(
                  "h-5 w-5 rounded-full flex items-center justify-center text-[10px] border",
                  step === s.id ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                )}>
                  {i + 1}
                </div>
                {s.label}
              </div>
              {i < 2 && <div className="mx-3 h-[1px] w-8 bg-muted-foreground/20" />}
            </div>
          ))}
        </div>

        <div className="min-h-[280px]">
          {/* STEP 1: SOURCE INFO */}
          {step === 'source' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Source Product</Label>
                  <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-xl border">
                    <Package className="h-6 w-6 text-muted-foreground" />
                    <div>
                      <p className="font-bold">{parentProduct.name}</p>
                      <p className="text-sm text-muted-foreground">Available Stock: {formatQuantity(parentProduct.stock)} {parentProduct.unitOfMeasure}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="qtyToBreak" className="text-primary font-bold">Quantity to Use/Break</Label>
                  <Input
                    id="qtyToBreak"
                    type="number"
                    value={quantityToBreak}
                    onChange={(e) => setQuantityToBreak(e.target.value)}
                    className="h-12 text-lg font-bold"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground italic">Enter how many {parentProduct.unitOfMeasure} you are opening/breaking.</p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: TARGET SELECTION */}
          {step === 'target' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="font-bold">Destination Product</Label>
                  <div className="flex gap-1 p-1 bg-muted rounded-full">
                    <Button
                      variant={targetMode === 'search' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="rounded-full text-xs h-7"
                      onClick={() => setTargetMode('search')}
                    >
                      Search
                    </Button>
                    <Button
                      variant={targetMode === 'create' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="rounded-full text-xs h-7"
                      onClick={() => setTargetMode('create')}
                    >
                      Quick Create
                    </Button>
                  </div>
                </div>

                {targetMode === 'search' && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search pack product..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setSelectedTarget(null); }}
                        className="pl-9"
                        autoFocus
                      />
                    </div>

                    {isSearching && <p className="text-[10px] text-muted-foreground animate-pulse">Searching...</p>}

                    {searchResults.length > 0 && !selectedTarget && (
                      <div className="max-h-40 overflow-y-auto rounded-xl border divide-y shadow-sm">
                        {searchResults.map(p => (
                          <button
                            key={p.id}
                            className="w-full text-left p-3 hover:bg-muted/50 transition-colors flex items-center justify-between"
                            onClick={() => { setSelectedTarget(p); setSearchQuery(p.name); }}
                          >
                            <div>
                              <p className="text-sm font-bold">{p.name}</p>
                              <p className="text-xs text-muted-foreground">{p.baseUnitBarcode || p.barcode} · {p.unitOfMeasure}</p>
                            </div>
                            <PlusCircle className="h-4 w-4 text-primary opacity-50" />
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedTarget && (
                      <div className="p-4 bg-primary/5 rounded-xl border border-primary/20 flex items-center justify-between shadow-inner">
                        <div className="flex items-center gap-3">
                          <Link2 className="h-5 w-5 text-primary" />
                          <div>
                            <p className="text-sm font-bold">{selectedTarget.name}</p>
                            <p className="text-xs text-muted-foreground">{selectedTarget.unitOfMeasure}</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedTarget(null)}>Change</Button>
                      </div>
                    )}
                  </div>
                )}

                {targetMode === 'create' && (
                  <div className="grid grid-cols-2 gap-3 p-4 bg-muted/20 rounded-xl border border-dashed">
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs">Product Name</Label>
                      <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Salt 500g" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Unit</Label>
                      <Input value={newUnit} onChange={(e) => setNewUnit(e.target.value)} placeholder="e.g. Pack" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Price</Label>
                      <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: COUNTING */}
          {step === 'count' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
               <div className="text-center p-6 bg-muted/30 rounded-2xl border border-dashed border-primary/20">
                  <div className="flex items-center justify-center gap-4 text-muted-foreground mb-1">
                    <span className="font-bold text-lg">{quantityToBreak} {parentProduct.unitOfMeasure}</span>
                    <ArrowRight className="h-4 w-4" />
                    <span className="font-bold text-lg">? {targetMode === 'create' ? newUnit : selectedTarget?.unitOfMeasure}</span>
                  </div>
                  <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/60">Stock Conversion Preview</p>
               </div>

               <div className="space-y-3">
                 <Label htmlFor="packsProduced" className="text-lg font-bold flex items-center gap-2">
                   <Package className="h-5 w-5 text-primary" />
                   Final Count of Packs Produced
                 </Label>
                 <Input
                  id="packsProduced"
                  type="number"
                  value={packsProduced}
                  onChange={(e) => setPacksProduced(e.target.value)}
                  placeholder="How many did you count?"
                  className="h-14 font-black text-3xl text-center border-primary/50"
                  autoFocus
                 />
                 {packsProduced && parseFloat(packsProduced) > 0 && (
                   <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
                     <Info className="h-3.5 w-3.5" />
                     Factor: {(parseFloat(packsProduced) / parseFloat(quantityToBreak)).toFixed(2)} per {parentProduct.unitOfMeasure}
                   </div>
                 )}
               </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6 flex-row justify-between sm:justify-between items-center bg-muted/20 -mx-6 -mb-6 p-6">
          <div className="flex gap-2">
            {step !== 'source' ? (
              <Button variant="ghost" onClick={() => setStep(step === 'count' ? 'target' : 'source')} disabled={isBreaking}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={isBreaking}>Cancel</Button>
            )}
          </div>

          {step === 'count' ? (
            <Button
              disabled={!packsProduced || parseFloat(packsProduced) <= 0 || isBreaking}
              onClick={handleFinish}
              className="px-8 font-bold bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {isBreaking ? 'Processing...' : 'Complete Repackage'}
            </Button>
          ) : (
            <Button
              disabled={
                (step === 'source' && (!quantityToBreak || parseFloat(quantityToBreak) <= 0)) ||
                (step === 'target' && (targetMode === 'search' ? !selectedTarget : (!newName || !newUnit || !newPrice)))
              }
              onClick={() => setStep(step === 'source' ? 'target' : 'count')}
              className="px-8 font-bold"
            >
              Next Step <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
