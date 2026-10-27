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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Product } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Package, Tags, CreditCard, Info, LayoutDashboard, History, Warehouse, BarChart3, Banknote, Pencil, AlertTriangle, Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, formatQuantity } from '@/lib/utils';

import { EditProductDialog } from '../edit-product/edit-product-dialog';
import { BreakPackDialog } from '../break-pack/break-pack-dialog';
import { DetailItem } from './detail-item';
import { SectionHeader } from './section-header';
import { GlanceStrip } from './glance-strip';
import { SellingUnitsTab } from './selling-units-tab';
import { StockTab } from './stock-tab';

const DAY_MS = 24 * 60 * 60 * 1000;

export function ViewProductDialog({
    product,
    onProductUpdated,
    products,
    productOptions,
    onOptionsRefresh,
    trigger,
    open: externalOpen,
    onOpenChange: externalOnOpenChange,
}: {
    product: Product;
    onProductUpdated?: () => void;
    products?: Product[];
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

    const isLowStock = product.stock <= effectiveReorderPoint;

    // Expiration is an alert only while it is still ahead; a date already past
    // is a different problem and reads as such.
    const daysToExpiry = product.expirationDate
        ? Math.ceil((new Date(product.expirationDate).getTime() - Date.now()) / DAY_MS)
        : null;
    const isExpiringSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 30;
    const isExpired = daysToExpiry !== null && daysToExpiry < 0;

    const alertCount = (isLowStock ? 1 : 0) + (isExpiringSoon || isExpired ? 1 : 0);

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            {trigger && (
                <DialogTrigger asChild>
                    {trigger}
                </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
                 <DialogHeader className="sr-only">
                    <DialogTitle>{product.name}</DialogTitle>
                    <DialogDescription>{product.description}</DialogDescription>
                 </DialogHeader>

                 <Tabs defaultValue="overview" className="flex flex-col min-h-0 flex-1">

                    {/* HEADER */}
                    <div className="border-b bg-background px-6 pt-5 shrink-0">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <h2 className="text-2xl font-bold tracking-tight">{product.name}</h2>
                                    <Badge
                                        className={cn(
                                            "px-2.5 py-0.5 text-xs shadow-sm font-medium",
                                            product.availability === 'Available' || product.availability === 'in-stock'
                                                ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20"
                                                : "bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/20"
                                        )}
                                        variant="outline"
                                    >
                                        {product.availability}
                                    </Badge>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                    {product.brand && <span>{product.brand}</span>}
                                    {product.category && <><span className="text-border">/</span><span>{product.category}</span></>}
                                    {product.subcategory && <><span className="text-border">/</span><span>{product.subcategory}</span></>}
                                    <Badge variant="outline" className="ml-0.5 px-2 py-0 font-mono text-xs">
                                        {product.sellingUnits?.find((su) => su.isBase)?.barcode || product.barcode || 'No barcode'}
                                    </Badge>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
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
                        </div>

                        {product.additionalDescription && (
                            <p className="mt-3 rounded-md border-l-4 border-primary/20 bg-muted/50 p-2.5 text-sm italic text-muted-foreground">
                                {product.additionalDescription}
                            </p>
                        )}

                        {/* ALERTS */}
                        {alertCount > 0 && (
                            <div className="mt-4 space-y-1.5">
                                {isLowStock && (
                                    <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5">
                                        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-destructive">
                                                Below reorder point &mdash; {formatQuantity(product.stock, product.unitOfMeasure)} left,
                                                reorder at {formatQuantity(effectiveReorderPoint, product.unitOfMeasure)}
                                            </p>
                                            {product.avgDailySales > 0 && (
                                                <p className="text-xs text-destructive/90">
                                                    Selling {Number(product.avgDailySales).toFixed(1)}/day &middot; about{' '}
                                                    {Math.floor(product.stock / Number(product.avgDailySales))} days of cover left.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {(isExpiringSoon || isExpired) && (
                                    <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
                                        <Clock className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold text-amber-700 dark:text-amber-500">
                                                {isExpired
                                                    ? `Expired ${Math.abs(daysToExpiry as number)} days ago`
                                                    : `Expires in ${daysToExpiry} ${daysToExpiry === 1 ? 'day' : 'days'}`}
                                                {' '}&mdash; {new Date(product.expirationDate as string).toLocaleDateString()}
                                            </p>
                                            <p className="text-xs text-amber-700/90 dark:text-amber-500/90">
                                                Oldest stock sells first under FIFO.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* AT-A-GLANCE */}
                        <div className="mt-4">
                            <GlanceStrip product={product} effectiveReorderPoint={effectiveReorderPoint} />
                        </div>

                        {/* TABS */}
                        <TabsList className="mt-4 h-auto w-full justify-start gap-1 rounded-none border-0 bg-transparent p-0">
                            <TabsTrigger
                                value="overview"
                                className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                            >
                                Overview
                            </TabsTrigger>
                            <TabsTrigger
                                value="stock"
                                className="gap-1.5 rounded-none border-b-2 border-transparent px-3.5 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                            >
                                Stock &amp; Movement
                                {alertCount > 0 && (
                                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive/15 px-1 text-[10px] font-bold text-destructive">
                                        {alertCount}
                                    </span>
                                )}
                            </TabsTrigger>
                            <TabsTrigger
                                value="pricing"
                                className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                            >
                                Selling Units &amp; Pricing
                            </TabsTrigger>
                            <TabsTrigger
                                value="more"
                                className="rounded-none border-b-2 border-transparent px-3.5 py-2.5 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                            >
                                More
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    {/* BODY */}
                    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-6">

                        <TabsContent value="overview" className="mt-0">
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                                <div className="rounded-xl border bg-card p-4">
                                    <SectionHeader title="Classification" icon={Tags} />
                                    <div className="grid grid-cols-1 gap-1">
                                        <DetailItem label="Brand" value={product.brand} icon={LayoutDashboard} />
                                        {product.department && <DetailItem label="Department" value={product.department} icon={Package} />}
                                        <DetailItem label="Category" value={product.category} icon={BarChart3} />
                                        {product.subcategory && <DetailItem label="Subcategory" value={product.subcategory} icon={BarChart3} />}
                                        {product.supplierName && <DetailItem label="Supplier" value={product.supplierName} icon={Warehouse} />}
                                    </div>
                                </div>

                                <div className="rounded-xl border bg-card p-4">
                                    <SectionHeader title="Where it sits" icon={Package} />
                                    <div className="grid grid-cols-1 gap-1">
                                        {product.warehouseName && <DetailItem label="Warehouse" value={product.warehouseName} icon={Warehouse} />}
                                        {(product.shelfLocationNames || product.shelfLocationName) && (
                                            <DetailItem label="Shelf Location" value={product.shelfLocationNames || product.shelfLocationName} icon={Warehouse} />
                                        )}
                                        <DetailItem label="Base Unit" value={product.unitOfMeasure} icon={Package} />
                                        <DetailItem
                                            label="Reorder Point"
                                            value={product.reorderPoint !== undefined && product.reorderPoint !== null
                                                ? formatQuantity(product.reorderPoint, product.unitOfMeasure)
                                                : 'Not set'}
                                            icon={History}
                                        />
                                    </div>
                                </div>

                                <div className="rounded-xl border bg-card p-4">
                                    <SectionHeader title="Tax &amp; Lifecycle" icon={CreditCard} />
                                    <div className="grid grid-cols-1 gap-1">
                                        {product.vatStatus && (
                                            <DetailItem
                                                label="VAT Status"
                                                value={<Badge variant="secondary" className="font-normal">{product.vatStatus}</Badge>}
                                                icon={Info}
                                            />
                                        )}
                                        <DetailItem label="Avg. Daily Sales" value={product.avgDailySales || '0.00'} icon={BarChart3} />
                                        {product.expirationDate && (
                                            <DetailItem
                                                label="Expiration Date"
                                                value={
                                                    <span className={cn((isExpiringSoon || isExpired) && 'font-medium text-amber-600 dark:text-amber-500')}>
                                                        {new Date(product.expirationDate).toLocaleDateString()}
                                                    </span>
                                                }
                                                icon={History}
                                            />
                                        )}
                                        {product.updatedAt && <DetailItem label="Last Updated" value={new Date(product.updatedAt).toLocaleDateString()} icon={History} />}
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="stock" className="mt-0">
                            <StockTab product={product} />
                        </TabsContent>

                        <TabsContent value="pricing" className="mt-0">
                            <SellingUnitsTab product={product} />
                        </TabsContent>

                        <TabsContent value="more" className="mt-0">
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                                <div className="rounded-xl border bg-card p-4">
                                    <SectionHeader title="Accounting" icon={Banknote} />
                                    {(product.incomeAccount || product.expenseAccount) ? (
                                        <div className="grid grid-cols-1 gap-1">
                                            {product.incomeAccount && <DetailItem label="Income Account" value={product.incomeAccount} icon={Info} />}
                                            {product.expenseAccount && <DetailItem label="Expense Account" value={product.expenseAccount} icon={Info} />}
                                        </div>
                                    ) : (
                                        <p className="px-3 py-2 text-sm text-muted-foreground">No accounts mapped to this product.</p>
                                    )}
                                </div>

                                <div className="rounded-xl border bg-card p-4">
                                    <SectionHeader title="Identifiers &amp; Lifecycle" icon={Info} />
                                    <div className="grid grid-cols-1 gap-1">
                                        {product.sku && <DetailItem label="SKU" value={product.sku} icon={Info} className="font-mono" />}
                                        {product.barcode && <DetailItem label="Product Barcode" value={product.barcode} icon={Info} className="font-mono" />}
                                        {product.markupPercentage !== undefined && product.markupPercentage !== null && (
                                            <DetailItem
                                                label="Markup Override"
                                                value={`${product.markupPercentage}%`}
                                                icon={BarChart3}
                                            />
                                        )}
                                        {product.createdAt && <DetailItem label="Created" value={new Date(product.createdAt).toLocaleDateString()} icon={History} />}
                                    </div>
                                </div>

                                {product.conversionFactors && product.conversionFactors.length > 0 && (
                                    <div className="rounded-xl border bg-card p-4 md:col-span-2">
                                        <SectionHeader title="Conversion Units" icon={Package} />
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            {product.conversionFactors.map((cf, index) => (
                                                <div key={index} className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3">
                                                    <span className="flex items-center gap-2 text-sm font-medium">
                                                        <span className="h-2 w-2 rounded-full bg-primary" />
                                                        {cf.unit} to {product.unitOfMeasure}
                                                    </span>
                                                    <Badge variant="outline" className="border-primary/20 bg-primary/10 px-2 py-0 font-semibold text-primary">
                                                        1 = {cf.factor}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    </div>
                 </Tabs>

                 <DialogFooter className="shrink-0 border-t bg-background p-4 sm:justify-between flex items-center gap-4">
                     <p className="w-fit rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">ID: {product.id}</p>
                     <Button variant="outline" onClick={() => setIsOpen(false)}>Close</Button>
                 </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
