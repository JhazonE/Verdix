'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Package, ArrowRight, CheckCircle2, Info, Wand2 } from 'lucide-react';
import { cn, formatQuantity } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { useRepackagingForm } from './use-repackaging-form';

export function RepackagingForm({ onSuccess }: { onSuccess?: () => void }) {
  const {
    step,
    setStep,
    isLoading,
    sourceSearch,
    setSourceSearch,
    sourceResults,
    selectedSource,
    setSelectedSource,
    qtyToUse,
    setQtyToUse,
    targetType,
    setTargetType,
    targetSearch,
    setTargetSearch,
    targetResults,
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
    packsProduced,
    setPacksProduced,
    generateBarcode,
    handleProcess,
  } = useRepackagingForm({ onSuccess });

  return (
    <div className="space-y-8 max-w-2xl mx-auto py-4">
      {/* Progress Tracker */}
      <div className="flex items-center justify-between mb-8">
        {[
          { id: 'source', label: 'Source Item', icon: Package },
          { id: 'target', label: 'Target Item', icon: ArrowRight },
          { id: 'calculate', label: 'Count & Finish', icon: CheckCircle2 }
        ].map((s, i) => (
          <div key={s.id} className="flex items-center">
            <div className={cn(
              "flex flex-col items-center gap-2 px-4 transition-colors",
              step === s.id ? "text-primary" : "text-muted-foreground"
            )}>
              <div className={cn(
                "h-10 w-10 rounded-full border-2 flex items-center justify-center transition-all",
                step === s.id ? "border-primary bg-primary/10 scale-110" : "border-muted-foreground/30"
              )}>
                <s.icon className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest">{s.label}</span>
            </div>
            {i < 2 && <div className="h-[2px] w-12 bg-muted-foreground/20" />}
          </div>
        ))}
      </div>

      <div className="min-h-[300px]">
        {/* STEP 1: SOURCE SELECTION */}
        {step === 'source' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-lg font-semibold">Step 1: Select Bulk Item</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    placeholder="Search source product (e.g. Salt 25kg)..."
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
                <div className="p-6 bg-primary/5 rounded-2xl border border-primary/20 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xl font-bold text-primary">{selectedSource.name}</h4>
                      <p className="text-sm text-muted-foreground">{selectedSource.baseUnitBarcode || selectedSource.barcode}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedSource(null)}>Change</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-primary/10">
                    <div className="space-y-1">
                      <p className="text-xs uppercase text-muted-foreground font-bold italic">Available Stock</p>
                      <p className="text-2xl font-black">{formatQuantity(selectedSource.stock)} {selectedSource.unitOfMeasure}</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="qtyToUse" className="text-xs uppercase text-primary font-bold">Qty to Break/Use</Label>
                      <Input
                        id="qtyToUse"
                        type="number"
                        value={qtyToUse}
                        onChange={(e) => setQtyToUse(e.target.value)}
                        className="h-10 text-lg border-primary/30"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4">
              <Button
                size="lg"
                disabled={!selectedSource || !qtyToUse || parseFloat(qtyToUse) <= 0}
                onClick={() => setStep('target')}
                className="rounded-full px-8 h-12 text-lg"
              >
                Next: Select Target
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: TARGET SELECTION */}
        {step === 'target' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
             <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-semibold">Step 2: Destination Product</Label>
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
                      placeholder="Search existing pack product..."
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
                    <div className="p-6 bg-secondary/5 rounded-2xl border border-secondary/20 flex items-center justify-between">
                      <div>
                        <h4 className="text-xl font-bold">{selectedTarget.name}</h4>
                        <p className="text-sm text-muted-foreground">{selectedTarget.baseUnitBarcode || selectedTarget.barcode} · {selectedTarget.unitOfMeasure}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedTarget(null)}>Change</Button>
                    </div>
                  )}
                </div>
              )}

              {targetType === 'create' && (
                 <div className="grid grid-cols-2 gap-4 p-6 border rounded-2xl bg-muted/30">
                  <div className="col-span-2 space-y-2">
                    <Label>New Pack Product Name</Label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Salt 500g Pack" />
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
                Back to Source
              </Button>
              <Button
                size="lg"
                disabled={targetType === 'search' ? !selectedTarget : (!newName || !newUnit || !newPrice)}
                onClick={() => setStep('calculate')}
                className="rounded-full px-8 h-12 text-lg"
              >
                Next: Count Output
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: COUNT & FINISH */}
        {step === 'calculate' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-6">
              <div className="text-center p-8 bg-muted/50 rounded-3xl border border-dashed border-muted-foreground/30">
                <p className="text-muted-foreground mb-4 uppercase text-xs font-black tracking-widest">Process Summary</p>
                <div className="flex items-center justify-center gap-6">
                  <div className="text-center">
                    <p className="text-3xl font-black text-primary">{qtyToUse}</p>
                    <p className="text-xs text-muted-foreground uppercase">{selectedSource?.unitOfMeasure}</p>
                  </div>
                  <ArrowRight className="h-8 w-8 text-muted-foreground/40" />
                  <div className="text-center">
                    <p className="text-3xl font-black">?</p>
                    <p className="text-xs text-muted-foreground uppercase">{targetType === 'create' ? newUnit : selectedTarget?.unitOfMeasure}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="packsCount" className="text-xl font-bold flex items-center gap-2 italic">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    How many {targetType === 'create' ? newUnit : selectedTarget?.unitOfMeasure} did you produce?
                  </Label>
                  <Input
                    id="packsCount"
                    type="number"
                    value={packsProduced}
                    onChange={(e) => setPacksProduced(e.target.value)}
                    placeholder="Enter final count..."
                    className="h-14 text-3xl font-black text-center border-emerald-500/50 focus-visible:ring-emerald-500"
                  />
                </div>

                {packsProduced && parseFloat(packsProduced) > 0 && (
                  <div className="bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/20 flex items-center gap-3">
                    <Info className="h-5 w-5 text-emerald-600" />
                    <p className="text-sm text-emerald-700">
                      Conversion Factor: <span className="font-black">{(parseFloat(packsProduced) / parseFloat(qtyToUse)).toFixed(2)}</span> per {selectedSource?.unitOfMeasure}.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setStep('target')} className="rounded-full" disabled={isLoading}>
                Go Back
              </Button>
              <Button
                size="lg"
                disabled={!packsProduced || parseFloat(packsProduced) <= 0 || isLoading}
                onClick={handleProcess}
                className="rounded-full px-12 h-14 text-xl font-black bg-emerald-600 hover:bg-emerald-700"
              >
                {isLoading ? 'Processing...' : 'Complete Repackaging'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
