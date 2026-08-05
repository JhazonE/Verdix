'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Product } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Package, Tags, CreditCard, Info, LayoutDashboard, History, Warehouse, BarChart3, Banknote, Pencil } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, formatQuantity } from '@/lib/utils';

import { EditProductDialog } from '../edit-product/edit-product-dialog';
import { QuickAddChildDialog } from '../quick-add-child/quick-add-child-dialog';
import { BreakPackDialog } from '../break-pack/break-pack-dialog';
import { ReassignParentDialog } from '../reassign-parent/reassign-parent-dialog';
import { DetailItem } from './detail-item';
import { SectionHeader } from './section-header';

export function ViewProductDialog({
    product,
    onProductUpdated,
    products,
    onChildAdded,
    productOptions,
    onOptionsRefresh,
    trigger,
    open: externalOpen,
    onOpenChange: externalOnOpenChange
}: {
    product: Product;
    onProductUpdated?: () => void;
    products?: Product[];
    onChildAdded?: () => void;
    productOptions?: any;
    onOptionsRefresh?: () => void;
    trigger?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
    const setIsOpen = externalOnOpenChange !== undefined ? externalOnOpenChange : setInternalOpen;

    const { data: posSettings } = useQuery({
        queryKey: ['posSettings'],
        queryFn: async () => {
            const response = await fetch('/api/pos-settings');
            if (!response.ok) throw new Error('Failed to fetch POS settings');
            return response.json();
        }
    });
    const lowStockThreshold = posSettings?.data?.lowStockThreshold || 0;
    const effectiveReorderPoint = Math.max(product.reorderPoint || 0, lowStockThreshold);


    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            {trigger && (
                <DialogTrigger asChild>
                    {trigger}
                </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-0 gap-0">
                 <DialogHeader className="sr-only">
                    <DialogTitle>{product.name}</DialogTitle>
                    <DialogDescription>{product.description}</DialogDescription>
                 </DialogHeader>

                 <div className="bg-gradient-to-r from-primary/5 via-background to-background p-6 border-b sticky top-0 bg-background z-10">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="space-y-1">
                                <h2 className="text-2xl font-bold tracking-tight">{product.name}</h2>
                                <p className="text-muted-foreground max-w-2xl">{product.description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="px-3 py-1 font-mono text-sm shadow-sm">
                                    {product.sku}
                                </Badge>
                                <Badge
                                    className={cn(
                                        "px-3 py-1 text-sm shadow-sm font-medium",
                                        product.availability === 'Available' || product.availability === 'in-stock'
                                            ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20"
                                            : "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/20"
                                    )}
                                    variant="outline"
                                >
                                    {product.availability}
                                </Badge>
                            </div>
                        </div>
                        {product.additionalDescription && (
                            <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground italic border-l-4 border-primary/20">
                                {product.additionalDescription}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-6 space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
                        {/* Section 1: Identity & Classification */}
                        <div className="md:col-span-4 space-y-6">
                            <div>
                                <SectionHeader title="Classification" icon={Tags} />
                                <div className="grid grid-cols-1 gap-2">
                                    <DetailItem label="Brand" value={product.brand} icon={LayoutDashboard} />
                                    {product.department && <DetailItem label="Department" value={product.department} icon={Package} />}
                                    <DetailItem label="Category" value={product.category} icon={BarChart3} />
                                    {product.subcategory && <DetailItem label="Subcategory" value={product.subcategory} icon={BarChart3} />}
                                    {product.supplierName && <DetailItem label="Supplier" value={product.supplierName} icon={Warehouse} />}
                                </div>
                            </div>
                        </div>

                        {/* Section 2: Codes & Inventory */}
                        <div className="md:col-span-4 space-y-6">
                            <div>
                                <SectionHeader title="Inventory" icon={Package} />
                                <div className="grid grid-cols-1 gap-2">
                                    {product.barcode && <DetailItem label="Barcode" value={product.barcode} icon={Info} className="font-mono" />}
                                    <DetailItem
                                        label="Current Stock"
                                        value={
                                            <div className="flex items-baseline gap-2">
                                                <span className={cn(
                                                    "text-2xl font-bold tracking-tight",
                                                    product.stock <= effectiveReorderPoint ? "text-destructive" : "text-foreground"
                                                )}>
                                                    {formatQuantity(product.stock, product.unitOfMeasure)}
                                                </span>
                                                <span className="text-sm text-muted-foreground font-normal">{product.unitOfMeasure}</span>
                                            </div>
                                        }
                                        icon={BarChart3}
                                    />
                                    <DetailItem label="Reorder Point" value={product.reorderPoint !== undefined && product.reorderPoint !== null ? formatQuantity(product.reorderPoint, product.unitOfMeasure) : 'Not set'} icon={History} />
                                    {product.warehouseName && <DetailItem label="Warehouse" value={product.warehouseName} icon={Warehouse} />}
                                    {(product.shelfLocationNames || product.shelfLocationName) && <DetailItem label="Shelf Location" value={product.shelfLocationNames || product.shelfLocationName} icon={Warehouse} />}
                                </div>
                            </div>
                        </div>

                        {/* Section 3: Financials & Logistics */}
                        <div className="md:col-span-4 space-y-6">
                            <div>
                                <SectionHeader title="Pricing" icon={CreditCard} />
                                <div className="grid grid-cols-1 gap-2">
                                    <DetailItem
                                        label="Retail Price"
                                        value={
                                            <span className="text-2xl font-bold text-primary tracking-tight">
                                                {typeof product.price === 'number' ? `₱${product.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A'}
                                            </span>
                                        }
                                        icon={Banknote}
                                    />
                                    <DetailItem
                                        label="Cost"
                                        value={product.cost && typeof product.cost === 'number' ? `₱${product.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'N/A'}
                                        icon={Banknote}
                                    />
                                    {product.vatStatus && (
                                        <DetailItem
                                            label="VAT Status"
                                            value={<Badge variant="secondary" className="font-normal">{product.vatStatus}</Badge>}
                                            icon={Info}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <Separator className="opacity-50" />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {/* More Info */}
                        <div className="space-y-4">
                            <SectionHeader title="Statistics & Lifecycle" icon={History} />
                            <div className="grid grid-cols-2 gap-4 bg-muted/20 p-4 rounded-xl border border-border/50">
                                <DetailItem label="Avg. Daily Sales" value={product.avgDailySales || '0.00'} icon={BarChart3} />
                                {product.expirationDate && (
                                    <DetailItem
                                        label="Expiration Date"
                                        value={<span className="text-orange-600 font-medium">{new Date(product.expirationDate).toLocaleDateString()}</span>}
                                        icon={History}
                                    />
                                )}
                                {product.createdAt && <DetailItem label="Created" value={new Date(product.createdAt).toLocaleDateString()} icon={History} />}
                                {product.updatedAt && <DetailItem label="Last Updated" value={new Date(product.updatedAt).toLocaleDateString()} icon={History} />}
                            </div>
                        </div>

                        {/* Accounting & Advanced */}
                        <div className="space-y-4">
                            {(product.incomeAccount || product.expenseAccount) && (
                                <>
                                    <SectionHeader title="Accounting" icon={Banknote} />
                                    <div className="grid grid-cols-2 gap-4 bg-muted/20 p-4 rounded-xl border border-border/50">
                                        {product.incomeAccount && <DetailItem label="Income Account" value={product.incomeAccount} icon={Info} />}
                                        {product.expenseAccount && <DetailItem label="Expense Account" value={product.expenseAccount} icon={Info} />}
                                    </div>
                                </>
                            )}

                            {( (product.priceLevels && product.priceLevels.length > 0) || (product.conversionFactors && product.conversionFactors.length > 0) ) && (
                                <div className="space-y-8 pt-4">
                                    {product.priceLevels && product.priceLevels.length > 0 && (
                                        <div className="space-y-4">
                                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                                <CreditCard className="h-3.5 w-3.5" />
                                                Price Levels
                                            </h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {product.priceLevels.map((pl, index) => (
                                                    <div key={index} className="flex justify-between items-center p-3 bg-card rounded-lg border border-border shadow-sm hover:border-primary/30 transition-colors">
                                                        <span className="text-sm font-medium text-muted-foreground">Level {index + 1}</span>
                                                        <span className="font-bold text-primary text-sm">₱{pl.price.toFixed(2)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {(() => {
                                        const hasConversionFactors = product.conversionFactors && product.conversionFactors.length > 0;
                                        const isChildProduct = product.parentId && products;
                                        const parentProduct = isChildProduct ? products?.find(p => p.id === product.parentId) : null;
                                        const childConversion = parentProduct?.conversionFactors?.find(cf => cf.unit === product.unitOfMeasure);

                                        if (hasConversionFactors || childConversion) {
                                            return (
                                                <div className="space-y-4">
                                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                                        <Package className="h-3.5 w-3.5" />
                                                        Conversion Units
                                                    </h4>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                        {hasConversionFactors && product.conversionFactors?.map((cf, index) => (
                                                            <div key={index} className="flex justify-between items-center p-3 bg-card rounded-lg border border-primary/20 shadow-sm bg-primary/5 hover:border-primary/30 transition-colors">
                                                                <span className="text-sm font-medium flex items-center gap-2">
                                                                    <div className="w-2 h-2 rounded-full bg-primary" />
                                                                    {cf.unit} to {product.unitOfMeasure}
                                                                </span>
                                                                <Badge variant="outline" className="font-semibold px-2 py-0 bg-primary/10 text-primary border-primary/20">1 = {cf.factor}</Badge>
                                                            </div>
                                                        ))}
                                                        {childConversion && parentProduct && (
                                                            <div className="flex justify-between items-center p-3 bg-card rounded-lg border border-emerald-500/20 shadow-sm bg-emerald-500/5 col-span-full">
                                                                <span className="text-sm font-medium flex items-center gap-2">
                                                                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                                                    {parentProduct.unitOfMeasure} to {product.unitOfMeasure}
                                                                </span>
                                                                <Badge variant="outline" className="font-semibold bg-emerald-500/10 text-emerald-600 border-emerald-500/20">1 = {childConversion.factor}</Badge>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="sticky bottom-0 bg-background p-6 border-t sm:justify-between flex items-center gap-4">
                     <p className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">ID: {product.id}</p>
                     <div className="flex items-center gap-3">
                        <Button variant="ghost" onClick={() => setIsOpen(false)} className="hover:bg-muted">Close</Button>
                        {!product.parentId && (product.conversionFactors?.length ?? 0) > 0 && products && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <QuickAddChildDialog
                                  parentProduct={product}
                                  baseStock={undefined}
                                  onChildAdded={() => {
                                    onChildAdded?.();
                                    onProductUpdated?.();
                                  }}
                                  products={products}
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Add child unit</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {!product.parentId && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <BreakPackDialog
                                  parentProduct={product}
                                  onPackBroken={() => {
                                    onProductUpdated?.();
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Break this pack into smaller units</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {products && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <ReassignParentDialog
                                  product={product}
                                  products={products}
                                  onProductUpdated={onProductUpdated}
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Move this product under a different parent</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <EditProductDialog
                          product={product}
                          onProductUpdated={onProductUpdated}
                          productOptions={productOptions}
                          onOptionsRefresh={onOptionsRefresh}
                          trigger={
                            <Button className="gap-2">
                              <Pencil className="h-4 w-4" />
                              Edit Product
                            </Button>
                          }
                        />
                     </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
