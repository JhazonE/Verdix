'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Package, ArrowLeft, CheckCircle2, Info, Wand2, PackagePlus } from 'lucide-react';
import { cn, formatQuantity } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { useConsolidationForm } from './use-consolidation-form';

export function ConsolidationForm({ onSuccess }: { onSuccess?: () => void }) {
  const {
    step,
    setStep,
    isLoading,
    sourceSearch,
    setSourceSearch,
    sourceResults,
    setSourceResults,
    selectedSource,
    setSelectedSource,
    packQtyUsed,
    setPackQtyUsed,
    targetType,
    setTargetType,
    targetSearch,
    setTargetSearch,
    targetResults,
    setTargetResults,
    selectedTarget,
    setSelectedTarget,
    newName,
    setNewName,
    newUnit,
    setNewUnit,
    newPrice,
    setNewPrice,
    newCost,
    setNewCost,
    newBarcode,
    setNewBarcode,
    units,
    factor,
    setFactor,
    bulkQtyPreview,
    generateBarcode,
    handleProcess,
  } = useConsolidationForm({ onSuccess });

  return (
    <div className="space-y-8 max-w-2xl mx-auto py-4">
      {/* Progress Tracker */}
      <div className="flex items-center justify-between mb-8">
        {[
          { id: 'source', label: 'Pack Item', icon: Package },
          { id: 'target', label: 'Bulk Target', icon: PackagePlus },
          { id: 'calculate', label: 'Factor & Finish', icon: CheckCircle2 },
        ].map((s, i) => (
          <div key={s.id} className="flex items-center">
            <div className={cn(
              'flex flex-col items-center gap-2 px-4 transition-colors',
              step === s.id ? 'text-violet-600' : 'text-muted-foreground'
            )}>
              <div className={cn(
                'h-10 w-10 rounded-full border-2 flex items-center justify-center transition-all',
                step === s.id ? 'border-violet-600 bg-violet-600/10 scale-110' : 'border-muted-foreground/30'
              )}>
                <s.icon className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{s.label}</span>
            </div>
            {i < 2 && <div className="h-[2px] w-12 bg-muted-foreground/20" />}
          </div>
        ))}
      </div>

      {/* Direction Banner */}
      <div className="flex items-center justify-center gap-3 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-2xl px-6 py-3">
        <Package className="h-5 w-5 text-violet-500" />
        <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">Pack Units</span>
        <ArrowLeft className="h-4 w-4 text-violet-400 rotate-180" />
        <ArrowLeft className="h-4 w-4 text-violet-400 rotate-180 -ml-3" />
        <PackagePlus className="h-5 w-5 text-violet-500" />
        <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">Bulk Product</span>
        <Badge variant="outline" className="ml-2 border-violet-300 text-violet-600 text-[10px]">Consolidation</Badge>
      </div>

      <div className="min-h-[300px]">
        {/* STEP 1: SOURCE PACK SELECTION */}
        {step === 'source' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-lg font-semibold">Step 1: Select Pack Item to Consolidate</Label>
                <p className="text-sm text-muted-foreground">Search for the small/pack product whose stock you want to merge back into a bulk unit.</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    placeholder="Search pack product (e.g. Salt 500g)..."
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                    className="pl-10 h-12 text-lg"
                  />
                </div>
              </div>

              {sourceResults.length > 0 && !selectedSource && (
                <div className="border rounded-xl divide-y overflow-hidden bg-card shadow-lg">
                  {sourceResults.map(p => (
                    <button
                      key={p.id}
                      className="w-full p-4 text-left hover:bg-muted/50 transition-colors flex items-center justify-between"
                      onClick={() => {
                        setSelectedSource(p);
                        setSourceSearch(p.name);
                        setSourceResults([]);
                      }}
                    >
                      <div>
                        <p className="font-bold">{p.name}</p>
                        <p className="text-sm text-muted-foreground">{p.baseUnitBarcode || p.barcode} · Stock: {formatQuantity(p.stock)} {p.unitOfMeasure}</p>
                      </div>
                      <Badge variant="outline">Select</Badge>
                    </button>
                  ))}
                </div>
              )}

              {selectedSource && (
                <div className="p-6 bg-violet-500/5 rounded-2xl border border-violet-500/20 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xl font-bold text-violet-600">{selectedSource.name}</h4>
                      <p className="text-sm text-muted-foreground">{selectedSource.baseUnitBarcode || selectedSource.barcode}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedSource(null); setSourceSearch(''); }}>Change</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-violet-500/10">
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground font-bold italic">Available Stock</p>
                      <p className="text-2xl font-black">{formatQuantity(selectedSource.stock)} <span className="text-sm font-normal text-muted-foreground">{selectedSource.unitOfMeasure}</span></p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="packQtyUsed" className="text-xs uppercase text-violet-600 font-bold">Qty of Packs to Use</Label>
                      <Input
                        id="packQtyUsed"
                        type="number"
                        value={packQtyUsed}
                        onChange={(e) => setPackQtyUsed(e.target.value)}
                        className="h-10 text-lg border-violet-500/30"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <Button
                size="lg"
                disabled={!selectedSource || !packQtyUsed || parseFloat(packQtyUsed) <= 0}
                onClick={() => setStep('target')}
                className="rounded-full px-8 h-12 text-lg bg-violet-600 hover:bg-violet-700"
              >
                Next: Select Bulk Target
                <PackagePlus className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: TARGET BULK SELECTION */}
        {step === 'target' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-semibold">Step 2: Bulk Target Product</Label>
                <div className="flex gap-1 p-1 bg-muted rounded-full">
                  <Button
                    variant={targetType === 'search' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="rounded-full px-4"
                    onClick={() => setTargetType('search')}
                  >
                    Search Existing
                  </Button>
                  <Button
                    variant={targetType === 'create' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="rounded-full px-4"
                    onClick={() => setTargetType('create')}
                  >
                    Quick Create
                  </Button>
                </div>
              </div>

              {targetType === 'search' && (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      placeholder="Search bulk product (e.g. Salt 25kg)..."
                      value={targetSearch}
                      onChange={(e) => setTargetSearch(e.target.value)}
                      className="pl-10 h-12 text-lg"
                    />
                  </div>

                  {targetResults.length > 0 && !selectedTarget && (
                    <div className="border rounded-xl divide-y overflow-hidden bg-card shadow-lg max-h-60 overflow-y-auto">
                      {targetResults.map(p => (
                        <button
                          key={p.id}
                          className="w-full p-4 text-left hover:bg-muted/50 transition-colors flex items-center justify-between"
                          onClick={() => {
                            setSelectedTarget(p);
                            setTargetSearch(p.name);
                            setTargetResults([]);
                          }}
                        >
                          <div>
                            <p className="font-bold">{p.name}</p>
                            <p className="text-sm text-muted-foreground">{p.baseUnitBarcode || p.barcode} · {p.unitOfMeasure}</p>
                          </div>
                          <Badge variant="outline">Select</Badge>
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedTarget && (
                    <div className="p-6 bg-emerald-500/5 rounded-2xl border border-emerald-500/20 flex items-center justify-between">
                      <div>
                        <h4 className="text-xl font-bold">{selectedTarget.name}</h4>
                        <p className="text-sm text-muted-foreground">{selectedTarget.baseUnitBarcode || selectedTarget.barcode} · {selectedTarget.unitOfMeasure}</p>
                        <p className="text-xs text-muted-foreground mt-1">Current stock: {formatQuantity(selectedTarget.stock)} {selectedTarget.unitOfMeasure}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedTarget(null); setTargetSearch(''); }}>Change</Button>
                    </div>
                  )}
                </div>
              )}

              {targetType === 'create' && (
                <div className="grid grid-cols-2 gap-4 p-6 border rounded-2xl bg-muted/30">
                  <div className="col-span-2 space-y-2">
                    <Label>New Bulk Product Name</Label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Salt 25kg Sack" />
                  </div>
                  <div className="space-y-2">
                    <Label>Unit of Measure</Label>
                    <Select value={newUnit} onValueChange={setNewUnit}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map(u => (
                          <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Barcode</Label>
                    <div className="relative">
                      <Input value={newBarcode} onChange={(e) => setNewBarcode(e.target.value)} placeholder="Barcode" className="pr-10" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground"
                        onClick={generateBarcode}
                        type="button"
                      >
                        <Wand2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Retail Price</Label>
                    <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Cost</Label>
                    <Input type="number" value={newCost} onChange={(e) => setNewCost(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setStep('source')} className="rounded-full">
                Back
              </Button>
              <Button
                size="lg"
                disabled={targetType === 'search' ? !selectedTarget : (!newName || !newUnit || !newPrice)}
                onClick={() => setStep('calculate')}
                className="rounded-full px-8 h-12 text-lg bg-violet-600 hover:bg-violet-700"
              >
                Next: Set Factor & Finish
                <CheckCircle2 className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: FACTOR & CONFIRM */}
        {step === 'calculate' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-6">
              {/* Summary */}
              <div className="text-center p-8 bg-muted/50 rounded-3xl border border-dashed border-muted-foreground/30">
                <p className="text-muted-foreground mb-4 uppercase text-xs font-black tracking-widest">Consolidation Summary</p>
                <div className="flex items-center justify-center gap-6">
                  <div className="text-center">
                    <p className="text-3xl font-black text-violet-600">{packQtyUsed}</p>
                    <p className="text-xs text-muted-foreground uppercase">{selectedSource?.unitOfMeasure}</p>
                    <p className="text-[10px] text-muted-foreground font-bold mt-1">{selectedSource?.name}</p>
                  </div>
                  <div className="flex flex-col items-center gap-1 text-muted-foreground/40">
                    <ArrowLeft className="h-8 w-8 rotate-180" />
                    <span className="text-[10px] font-bold uppercase">consolidate</span>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-black text-emerald-600">
                      {bulkQtyPreview > 0 ? bulkQtyPreview.toFixed(3).replace(/\.?0+$/, '') : '?'}
                    </p>
                    <p className="text-xs text-muted-foreground uppercase">
                      {targetType === 'create' ? newUnit : selectedTarget?.unitOfMeasure}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-bold mt-1">
                      {targetType === 'create' ? newName : selectedTarget?.name}
                    </p>
                  </div>
                </div>
              </div>

              {/* Factor Input */}
              <div className="space-y-2">
                <Label htmlFor="consolidateFactor" className="text-xl font-bold flex items-center gap-2 italic">
                  <CheckCircle2 className="h-5 w-5 text-violet-500" />
                  How many {selectedSource?.unitOfMeasure} = 1 {targetType === 'create' ? newUnit : selectedTarget?.unitOfMeasure}?
                </Label>
                <Input
                  id="consolidateFactor"
                  type="number"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                  placeholder="e.g. 50 (50 packs = 1 bulk)"
                  className="h-14 text-3xl font-black text-center border-violet-500/50 focus-visible:ring-violet-500"
                />
              </div>

              {factor && parseFloat(factor) > 0 && (
                <div className="bg-violet-500/5 p-4 rounded-xl border border-violet-500/20 flex items-center gap-3">
                  <Info className="h-5 w-5 text-violet-600 shrink-0" />
                  <p className="text-sm text-violet-700 dark:text-violet-300">
                    <span className="font-black">{packQtyUsed}</span> {selectedSource?.unitOfMeasure} ÷ <span className="font-black">{factor}</span> = <span className="font-black">{bulkQtyPreview.toFixed(4).replace(/\.?0+$/, '')}</span> {targetType === 'create' ? newUnit : selectedTarget?.unitOfMeasure} will be added to bulk stock.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setStep('target')} className="rounded-full" disabled={isLoading}>
                Go Back
              </Button>
              <Button
                disabled={!factor || parseFloat(factor) <= 0 || isLoading}
                onClick={handleProcess}
                className="rounded-full px-12 h-14 text-xl font-black bg-violet-600 hover:bg-violet-700"
              >
                {isLoading ? 'Processing...' : 'Complete Consolidation'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
