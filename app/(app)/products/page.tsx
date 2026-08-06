'use client';

import Image from 'next/image';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Product } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AddProductDialog } from './add-product/add-product-dialog';
import { QuickAddChildDialog } from './quick-add-child/quick-add-child-dialog';
import { ManageBrandsDialog } from './brands/ManageBrandsDialog';
import { ManageCategoriesDialog } from './categories/ManageCategoriesDialog';
import { ManageDepartmentsDialog } from './departments/ManageDepartmentsDialog';
import { EditProductDialog } from './edit-product/edit-product-dialog';
import { ManagePriceLevelsDialog } from './price-levels/ManagePriceLevelsDialog';
import { ManageSuppliersDialog } from './suppliers/ManageSuppliersDialog';
import { ManageShelfLocationsDialog } from './shelf-locations/ManageShelfLocationsDialog';
import { ManageUnitOfMeasureDialog } from './units-of-measure/ManageUnitOfMeasureDialog';
import { ManageWarehousesDialog } from '../sales/manage-warehouses/ManageWarehousesDialog';
import { BulkPriceUpdateDrawer } from './bulk-price-update/BulkPriceUpdateDrawer';

import { Search, ChevronDown, Trash2, PlusCircle, Settings, ShoppingCart, MoreVertical, Edit, Eye, Copy, AlertTriangle, Printer } from 'lucide-react';
import { PrintBarcodeDialog } from './print-barcode/print-barcode-dialog';
import { useState, useMemo, Fragment, useEffect, useCallback, Suspense } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn, formatQuantity, formatStockQuantity } from '@/lib/utils';
import { ViewProductDialog } from './view-product/view-product-dialog';
import { getProducts, getProductsCount, deleteProduct, getDepartments } from './actions';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { AddPurchaseOrderDialog } from '../purchases/add-purchase-order/add-purchase-order-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { addChildProduct } from './actions';
import { useLiveRefresh, dispatchStockUpdate } from '@/hooks/use-live-refresh';

function ProductRow({ product, onProductDeleted, onProductUpdated, products, productOptions, onOptionsRefresh, depth = 0, lowStockThreshold }: {
  product: ProductWithChildren;
  onProductDeleted?: () => void;
  onProductUpdated?: () => void;
  products: Product[];
  productOptions?: any;
  onOptionsRefresh?: () => void;
  depth?: number;
  lowStockThreshold?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [restockDialogOpen, setRestockDialogOpen] = useState(false);
  const [addChildDialogOpen, setAddChildDialogOpen] = useState(false);
  const [printBarcodeOpen, setPrintBarcodeOpen] = useState(false);

  const { toast } = useToast();
  // Services carry no stock, so the stock ladder does not apply — flagging one
  // "Out of Stock" reads as a problem to fix when it is simply how they work.
  const isServiceProduct = product.type === 'service';

  // Effective threshold matches the Low Stock filter/report/notification bell:
  // a product is low stock once it drops under its own reorder point OR the
  // store-wide Low Stock Threshold, whichever is higher.
  const effectiveReorderPoint = Math.max(product.reorderPoint, lowStockThreshold || 0);
  const stockStatus =
    isServiceProduct
      ? 'service'
      : product.stock <= 0
      ? 'out-of-stock'
      : product.stock < effectiveReorderPoint
        ? 'low-stock'
        : 'in-stock';

  const badgeVariant =
    stockStatus === 'service'
      ? 'outline'
      : stockStatus === 'out-of-stock'
      ? 'destructive'
      : stockStatus === 'low-stock'
        ? 'destructive'
        : 'default';
  const badgeText =
    stockStatus === 'service'
      ? 'Available'
      : stockStatus === 'out-of-stock'
      ? 'Out of Stock'
      : stockStatus === 'low-stock'
        ? 'Low Stock'
        : 'In Stock';

  const handleDeleteConfirm = async () => {
    const result = await deleteProduct(product.id);
    if (result.success) {
      toast({
        title: 'Product deleted',
        description: result.message,
      });
      if (onProductDeleted) onProductDeleted();
      setDeleteDialogOpen(false);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error deleting product',
        description: result.message,
      });
    }
  };

  const hasChildren = product.children && product.children.length > 0;
  const indentStyle = { paddingLeft: `${depth * 24}px` };

  return (
    <>
      <TableRow className={cn(depth > 0 && "bg-muted/20")}>
        <TableCell className="hidden sm:table-cell" style={indentStyle}>
          {hasChildren ? (
            <Button variant="ghost" size="icon" className="group" onClick={() => setIsOpen(!isOpen)}>
              <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-180")} />
            </Button>
          ) : depth > 0 ? (
            <div className="text-sm text-muted-foreground">└</div>
          ) : (
            <div className="w-10"></div>
          )}
        </TableCell>
        <TableCell className="font-medium">
          {product.name}
          {product.parentId && <div className="text-xs text-muted-foreground">Child Unit</div>}
          {product.expirationDate && (
            <div className="text-[10px] text-orange-600 font-medium flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-600" />
              Exp: {new Date(product.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}
        </TableCell>
        <TableCell className="hidden md:table-cell">{product.sku}</TableCell>
        <TableCell className="hidden lg:table-cell">{product.barcode}</TableCell>
        <TableCell>
          <Badge variant={badgeVariant}>{badgeText}</Badge>
        </TableCell>
        <TableCell className="hidden sm:table-cell text-center text-muted-foreground">
          {product.unitOfMeasure}
        </TableCell>
        <TableCell className="text-center font-bold">
          {formatStockQuantity(product.stock)}
        </TableCell>
        <TableCell className="hidden md:table-cell text-right">
          {product.cost && typeof product.cost === 'number' ? `₱${product.cost.toFixed(2)}` : '—'}
        </TableCell>
        <TableCell className="hidden md:table-cell text-right">
          {typeof product.price === 'number' ? `₱${product.price.toFixed(2)}` : 'N/A'}
        </TableCell>
        <TableCell className="hidden md:table-cell text-center">
          {product.warehouseName || '—'}
        </TableCell>
        <TableCell className="hidden md:table-cell text-center">
          {product.shelfLocationNames || product.shelfLocationName || '—'}
        </TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setViewDialogOpen(true)}>
                <Eye className="mr-2 h-4 w-4" />
                <span>View Details</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                <Edit className="mr-2 h-4 w-4" />
                <span>Edit Product</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPrintBarcodeOpen(true)}>
                <Printer className="mr-2 h-4 w-4" />
                <span>Print Barcode</span>
              </DropdownMenuItem>

              {/* Restock Option */}
              {stockStatus !== 'in-stock' && (
                  <DropdownMenuItem onClick={() => setRestockDialogOpen(true)} className="text-orange-600 focus:text-orange-600">
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    <span>Restock</span>
                  </DropdownMenuItem>
              )}

              {/* Add child product option - available on any product with its own conversion factors */}
              {product.conversionFactors && product.conversionFactors.length > 0 ? (
                  <DropdownMenuItem onClick={() => setAddChildDialogOpen(true)}>
                    <Copy className="mr-2 h-4 w-4" />
                    <span>Add Child Unit</span>
                  </DropdownMenuItem>
              ) : null}
              
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-red-600 focus:text-red-600"
                onSelect={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete Product</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Action Dialogs - Nested here to avoid invalid tbody structure */}
          <div className="hidden">
            <PrintBarcodeDialog
              open={printBarcodeOpen}
              onOpenChange={setPrintBarcodeOpen}
              product={product}
            />
            <ViewProductDialog
                open={viewDialogOpen}
                onOpenChange={setViewDialogOpen}
                product={product}
                onProductUpdated={onProductUpdated}
                products={products}
                onChildAdded={onProductDeleted}
                productOptions={productOptions}
                onOptionsRefresh={onOptionsRefresh}
            />
            <EditProductDialog 
                open={editDialogOpen}
                onOpenChange={setEditDialogOpen}
                product={product} 
                onProductUpdated={onProductUpdated} 
                productOptions={productOptions}
                onOptionsRefresh={onOptionsRefresh}
            />
            <AddPurchaseOrderDialog 
                open={restockDialogOpen}
                onOpenChange={setRestockDialogOpen}
                prefillProduct={product}
                onAddOrder={() => {
                  if (onProductUpdated) onProductUpdated();
                }}
            />
            {/* Always use the current product itself as the parent - supports multi-level nesting */}
            {product.conversionFactors && product.conversionFactors.length > 0 ? (
                <QuickAddChildDialog
                    open={addChildDialogOpen}
                    onOpenChange={setAddChildDialogOpen}
                    parentProduct={product}
                    baseStock={product.stock}
                    onChildAdded={onProductDeleted || (() => { })}
                    products={products}
                />
            ) : null}
          </div>
        </TableCell>
      </TableRow>

      {isOpen && hasChildren && product.children!.map(child => (
        <ProductRow
          key={child.id}
          product={child}
          onProductDeleted={onProductDeleted}
          onProductUpdated={onProductUpdated}
          products={products}
          productOptions={productOptions}
          onOptionsRefresh={onOptionsRefresh}
          depth={depth + 1}
          lowStockThreshold={lowStockThreshold}
        />
      ))}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the product "{product.name}" and all related data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProductSkeleton() {
  return (
    <TableRow>
      <TableCell className="hidden sm:table-cell w-12"><Skeleton className="h-5 w-5" /></TableCell>
      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-24" /></TableCell>
      <TableCell className="hidden lg:table-cell"><Skeleton className="h-5 w-24" /></TableCell>
      <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-10 mx-auto" /></TableCell>
      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
      <TableCell className="hidden md:table-cell text-right"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
      <TableCell className="hidden md:table-cell text-right"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20 mx-auto" /></TableCell>
      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20 mx-auto" /></TableCell>
      <TableCell className="text-right"><div className='flex gap-2 justify-end'><Skeleton className="h-8 w-8 rounded-full" /></div></TableCell>
    </TableRow>
  );
}

interface ProductWithChildren extends Product {
  children?: Product[];
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<Card><CardHeader><CardTitle>Loading...</CardTitle></CardHeader></Card>}>
        <ProductsContent />
    </Suspense>
  )
}

function ProductsContent() {
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const searchParams = useSearchParams();
  const filter = searchParams.get('filter');
  
  // Filter States (Active)
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [selectedShelfLocation, setSelectedShelfLocation] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>(filter === 'low-stock' ? 'low-stock' : 'all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');

  // Pending Filters (Inside Dialog)
  const [tempBrand, setTempBrand] = useState('all');
  const [tempCategory, setTempCategory] = useState('all');
  const [tempSupplier, setTempSupplier] = useState('all');
  const [tempWarehouse, setTempWarehouse] = useState('all');
  const [tempShelfLocation, setTempShelfLocation] = useState('all');
  const [tempStatus, setTempStatus] = useState(filter === 'low-stock' ? 'low-stock' : 'all');
  const [tempDepartment, setTempDepartment] = useState('all');

  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [isBrandsOpen, setIsBrandsOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [isPriceLevelsOpen, setIsPriceLevelsOpen] = useState(false);
  const [isSuppliersOpen, setIsSuppliersOpen] = useState(false);
  const [isShelfLocationsOpen, setIsShelfLocationsOpen] = useState(false);
  const [isDepartmentsOpen, setIsDepartmentsOpen] = useState(false);
  const [isUnitOfMeasureOpen, setIsUnitOfMeasureOpen] = useState(false);
  const [isWarehousesOpen, setIsWarehousesOpen] = useState(false);
  const [isBulkPriceUpdateOpen, setIsBulkPriceUpdateOpen] = useState(false);

  const filters = {
    search: debouncedSearchTerm || undefined,
    brand: selectedBrand !== 'all' ? selectedBrand : undefined,
    category: selectedCategory !== 'all' ? selectedCategory : undefined,
    supplier: selectedSupplier !== 'all' ? selectedSupplier : undefined,
    warehouse: selectedWarehouse !== 'all' ? selectedWarehouse : undefined,
    shelfLocation: selectedShelfLocation !== 'all' ? selectedShelfLocation : undefined,
    status: selectedStatus !== 'all' ? selectedStatus : undefined,
    department: selectedDepartment !== 'all' ? selectedDepartment : undefined,
  };

  const { data: productsDataResult, isLoading: isLoadingProducts, refetch } = useQuery({
    queryKey: ['products', currentPage, pageSize, filters],
    queryFn: async () => {
      const [productsData, totalCount] = await Promise.all([
        getProducts(pageSize, (currentPage - 1) * pageSize, filters),
        getProductsCount(filters)
      ]);
      return { productsData, totalCount };
    },
  });

  const allProducts = productsDataResult?.productsData || [];
  const totalProducts = productsDataResult?.totalCount || 0;

  const { data: productOptions, isLoading: isLoadingOptions, refetch: refetchOptions } = useQuery({
    queryKey: ['productOptions'],
    queryFn: async () => {
      const { getProductOptions } = await import('./actions');
      return getProductOptions();
    }
  });

  const { data: posSettings } = useQuery({
    queryKey: ['posSettings'],
    queryFn: async () => {
      const response = await fetch('/api/pos-settings');
      if (!response.ok) throw new Error('Failed to fetch POS settings');
      return response.json();
    }
  });
  const lowStockThreshold = posSettings?.data?.lowStockThreshold;

  const loadProducts = useCallback((page?: number, size?: number) => {
    refetch();
  }, [refetch]);

  const loadProductOptions = useCallback(() => {
    refetchOptions();
  }, [refetchOptions]);

  useLiveRefresh(refetch);

  // Reset to page 1 when structural filters or search term change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBrand, selectedCategory, selectedSupplier, selectedWarehouse, selectedShelfLocation, selectedStatus, selectedDepartment, debouncedSearchTerm]);

  const filtersActive = useMemo(() => {
    return selectedBrand !== 'all' || selectedCategory !== 'all' || selectedSupplier !== 'all' || selectedWarehouse !== 'all' || selectedShelfLocation !== 'all' || selectedStatus !== 'all' || selectedDepartment !== 'all' || !!debouncedSearchTerm;
  }, [selectedBrand, selectedCategory, selectedSupplier, selectedWarehouse, selectedShelfLocation, selectedStatus, selectedDepartment, debouncedSearchTerm]);

  // Server-side results are already filtered
  const products = useMemo(() => {
    return allProducts;
  }, [allProducts]);

  const productTree = useMemo(() => {
    if (!products) return [];

    // If filters are active, show flat list
    if (filtersActive) {
        return products.map((p: Product) => ({ ...p, children: [] }));
    }

    // Build a recursive tree structure
    const buildTree = (parentId: string | null = null, depth = 0): ProductWithChildren[] => {
      return products
        .filter((p: Product) => {
            if (parentId === null) {
                return p.parentId == null; // Loose equality to catch null and undefined
            }
            return p.parentId === parentId;
        })
        .map((p: Product) => ({
          ...p,
          children: depth < 10 ? buildTree(p.id, depth + 1) : [], // Prevent infinite recursion, max depth 10
        }));
    };

    return buildTree();
  }, [products, filtersActive]);

  const filteredProducts = useMemo(() => {
    return productTree;
  }, [productTree]);

  return (
    <div className="flex flex-col h-full gap-6 pt-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-2xl border border-border/50 bg-gradient-to-r from-muted/40 via-background to-muted/40 shadow-sm flex-shrink-0">
            <div className="relative group">
              <Search className="absolute left-3 top-[0.65rem] h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                type="search"
                placeholder="Search products..."
                className="pl-9 w-full sm:w-[320px] bg-background/70 border-input/50 focus:bg-background transition-all shadow-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="bg-background/50 backdrop-blur-sm">
                  <Settings className="mr-2 h-4 w-4" />
                  Manage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 glass-card">
                <DropdownMenuLabel>Product Settings</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsBrandsOpen(true), 0)}>
                  Manage Brands
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsCategoriesOpen(true), 0)}>
                  Manage Categories
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsPriceLevelsOpen(true), 0)}>
                  Manage Price Levels
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsSuppliersOpen(true), 0)}>
                  Manage Suppliers
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsShelfLocationsOpen(true), 0)}>
                  Manage Shelf Locations
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsDepartmentsOpen(true), 0)}>
                  Manage Departments
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsWarehousesOpen(true), 0)}>
                  Manage Warehouse
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTimeout(() => setIsUnitOfMeasureOpen(true), 0)}>
                  Manage Unit of Measure
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <ManageBrandsDialog 
                open={isBrandsOpen}
                onOpenChange={setIsBrandsOpen}
                onBrandAdded={() => loadProducts(currentPage, pageSize)}
                trigger={<span className="sr-only">Open Brands</span>}
            />
            <ManageCategoriesDialog 
                open={isCategoriesOpen}
                onOpenChange={setIsCategoriesOpen}
                onCategoryAdded={() => loadProducts(currentPage, pageSize)}
                trigger={<span className="sr-only">Open Categories</span>}
            />

             <ManagePriceLevelsDialog
                open={isPriceLevelsOpen}
                onOpenChange={setIsPriceLevelsOpen}
                onLevelAdded={() => { loadProductOptions(); loadProducts(currentPage, pageSize); }}
                trigger={<span className="sr-only">Open Price Levels</span>}
            />
             <ManageSuppliersDialog 
                open={isSuppliersOpen}
                onOpenChange={setIsSuppliersOpen}
                onSupplierAdded={() => loadProducts(currentPage, pageSize)}
                trigger={<span className="sr-only">Open Suppliers</span>}
            />
            <ManageShelfLocationsDialog 
                open={isShelfLocationsOpen}
                onOpenChange={setIsShelfLocationsOpen}
                onLocationAdded={() => loadProducts(currentPage, pageSize)}
                trigger={<span className="sr-only">Open Shelf Locations</span>}
            />
            <ManageDepartmentsDialog 
                open={isDepartmentsOpen}
                onOpenChange={setIsDepartmentsOpen}
                onDepartmentAdded={() => {
                    loadProductOptions();
                    loadProducts(currentPage, pageSize);
                }}
                trigger={<span className="sr-only">Open Departments</span>}
            />
            <ManageUnitOfMeasureDialog 
                open={isUnitOfMeasureOpen}
                onOpenChange={setIsUnitOfMeasureOpen}
                onUnitAdded={() => {
                    loadProductOptions();
                    loadProducts(currentPage, pageSize);
                }}
                trigger={<span className="sr-only">Open Units</span>}
            />
            <ManageWarehousesDialog 
                open={isWarehousesOpen}
                onOpenChange={setIsWarehousesOpen}
                onChange={() => {
                    loadProductOptions();
                    loadProducts(currentPage, pageSize);
                }}
                trigger={<span className="sr-only">Open Warehouses</span>}
            />
            <BulkPriceUpdateDrawer
              open={isBulkPriceUpdateOpen}
              onOpenChange={setIsBulkPriceUpdateOpen}
              productOptions={productOptions || {}}
              onUpdated={() => loadProducts(currentPage, pageSize)}
            />
            <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" onClick={() => {
                   // Sync temp with actual when opening
                   setTempBrand(selectedBrand);
                   setTempCategory(selectedCategory);
                   setTempSupplier(selectedSupplier);
                   setTempWarehouse(selectedWarehouse);
                   setTempShelfLocation(selectedShelfLocation);
                   setTempStatus(selectedStatus);
                   setTempDepartment(selectedDepartment);
                }}>
                   <span className="sr-only">Open filters</span>
                   <Settings className="h-4 w-4 mr-2" />
                   Filter Products
                   {(selectedBrand !== 'all' || selectedCategory !== 'all' || selectedSupplier !== 'all' || selectedWarehouse !== 'all' || selectedShelfLocation !== 'all' || selectedStatus !== 'all' || selectedDepartment !== 'all') && (
                       <Badge variant="secondary" className="ml-1 h-5 w-5 rounded-full p-0 flex items-center justify-center">
                           {
                               [selectedBrand, selectedCategory, selectedSupplier, selectedWarehouse, selectedShelfLocation, selectedStatus, selectedDepartment].filter(v => v !== 'all').length
                           }
                       </Badge>
                   )}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Filter Products</DialogTitle>
                  <DialogDescription>
                    Narrow down your product list using the filters below.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="brand-filter">Brand</Label>
                    <Select value={tempBrand} onValueChange={setTempBrand}>
                      <SelectTrigger id="brand-filter">
                        <SelectValue placeholder="All Brands" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Brands</SelectItem>
                        {productOptions?.brands?.map((brand: any) => (
                          <SelectItem key={brand.id} value={brand.name}>
                            {brand.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="category-filter">Category</Label>
                    <Select value={tempCategory} onValueChange={setTempCategory}>
                      <SelectTrigger id="category-filter">
                        <SelectValue placeholder="All Categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {productOptions?.categories?.map((category: any) => (
                          <SelectItem key={category.id} value={category.name}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="supplier-filter">Supplier</Label>
                    <Select value={tempSupplier} onValueChange={setTempSupplier}>
                      <SelectTrigger id="supplier-filter">
                        <SelectValue placeholder="All Suppliers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Suppliers</SelectItem>
                        {productOptions?.suppliers?.map((supplier: any) => (
                          <SelectItem key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="warehouse-filter">Warehouse</Label>
                    <Select value={tempWarehouse} onValueChange={setTempWarehouse}>
                      <SelectTrigger id="warehouse-filter">
                        <SelectValue placeholder="All Warehouses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Warehouses</SelectItem>
                        {productOptions?.warehouses?.map((warehouse: any) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="shelf-filter">Shelf Location</Label>
                    <Select value={tempShelfLocation} onValueChange={setTempShelfLocation}>
                      <SelectTrigger id="shelf-filter">
                        <SelectValue placeholder="All Shelves" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Shelves</SelectItem>
                        {productOptions?.shelfLocations?.map((shelf: any) => (
                          <SelectItem key={shelf.id} value={shelf.id}>
                            {shelf.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="status-filter">Status</Label>
                    <Select value={tempStatus} onValueChange={setTempStatus}>
                      <SelectTrigger id="status-filter">
                        <SelectValue placeholder="All Statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="in-stock">In Stock</SelectItem>
                        <SelectItem value="low-stock">Low Stock</SelectItem>
                        <SelectItem value="out-of-stock">Out of Stock</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="department-filter">Department</Label>
                    <Select value={tempDepartment} onValueChange={setTempDepartment}>
                      <SelectTrigger id="department-filter">
                        <SelectValue placeholder="All Departments" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Departments</SelectItem>
                        {productOptions?.departments?.map((dept: any) => (
                          <SelectItem key={dept.id} value={dept.name}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter className="flex justify-between sm:justify-between">
                   <Button variant="ghost" onClick={() => {
                       setTempBrand('all');
                       setTempCategory('all');
                       setTempSupplier('all');
                       setTempWarehouse('all');
                       setTempShelfLocation('all');
                       setTempStatus('all');
                       setTempDepartment('all');
                   }}>Reset</Button>
                   <Button onClick={() => {
                       setSelectedBrand(tempBrand);
                       setSelectedCategory(tempCategory);
                       setSelectedSupplier(tempSupplier);
                       setSelectedWarehouse(tempWarehouse);
                       setSelectedShelfLocation(tempShelfLocation);
                       setSelectedStatus(tempStatus);
                       setSelectedDepartment(tempDepartment);
                       setIsFilterDialogOpen(false);
                   }}>Apply Filters</Button>
                </DialogFooter>
              </DialogContent>
           </Dialog>
            <Button variant="outline" className="bg-background/50 backdrop-blur-sm" onClick={() => setIsBulkPriceUpdateOpen(true)}>
              Bulk Update Price
            </Button>
            <AddProductDialog
              onProductAdded={() => loadProducts(currentPage, pageSize)}
              productOptions={productOptions}
              onOptionsRefresh={loadProductOptions}
            />
      </div>

      <div className="flex flex-wrap items-center gap-3 flex-shrink-0">

        
        {/* Active Filters Badges */}
        {(selectedBrand !== 'all' || selectedCategory !== 'all' || selectedSupplier !== 'all' || selectedWarehouse !== 'all' || selectedShelfLocation !== 'all' || selectedStatus !== 'all' || selectedDepartment !== 'all') && (
            <div className="flex flex-wrap items-center gap-2">
                 {selectedBrand !== 'all' && (
                     <Badge variant="secondary" className="gap-1 pl-2">
                         Brand: {selectedBrand}
                         <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent" onClick={() => setSelectedBrand('all')}>
                             <span className="sr-only">Remove</span>
                             <span className="text-xs">×</span>
                         </Button>
                     </Badge>
                 )}
                 {selectedCategory !== 'all' && (
                     <Badge variant="secondary" className="gap-1 pl-2">
                         Category: {selectedCategory}
                         <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent" onClick={() => setSelectedCategory('all')}>
                             <span className="sr-only">Remove</span>
                             <span className="text-xs">×</span>
                         </Button>
                     </Badge>
                 )}
                 {selectedSupplier !== 'all' && (
                     <Badge variant="secondary" className="gap-1 pl-2">
                         Supplier: {productOptions?.suppliers?.find((s:any) => s.id === selectedSupplier)?.name || 'Unknown'}
                         <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent" onClick={() => setSelectedSupplier('all')}>
                             <span className="sr-only">Remove</span>
                             <span className="text-xs">×</span>
                         </Button>
                     </Badge>
                 )}
                 {selectedWarehouse !== 'all' && (
                     <Badge variant="secondary" className="gap-1 pl-2">
                         Warehouse: {productOptions?.warehouses?.find((w:any) => w.id === selectedWarehouse)?.name || 'Unknown'}
                         <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent" onClick={() => setSelectedWarehouse('all')}>
                             <span className="sr-only">Remove</span>
                             <span className="text-xs">×</span>
                         </Button>
                     </Badge>
                 )}
                 {selectedShelfLocation !== 'all' && (
                     <Badge variant="secondary" className="gap-1 pl-2">
                         Shelf: {productOptions?.shelfLocations?.find((sl:any) => sl.id === selectedShelfLocation)?.name || 'Unknown'}
                         <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent" onClick={() => setSelectedShelfLocation('all')}>
                             <span className="sr-only">Remove</span>
                             <span className="text-xs">×</span>
                         </Button>
                     </Badge>
                 )}
                 {selectedStatus !== 'all' && (
                     <Badge variant="secondary" className="gap-1 pl-2">
                         Status: {selectedStatus === 'in-stock' ? 'In Stock' : selectedStatus === 'low-stock' ? 'Low Stock' : 'Out of Stock'}
                         <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent" onClick={() => setSelectedStatus('all')}>
                             <span className="sr-only">Remove</span>
                             <span className="text-xs">×</span>
                         </Button>
                     </Badge>
                 )}
                 {selectedDepartment !== 'all' && (
                     <Badge variant="secondary" className="gap-1 pl-2">
                         Department: {selectedDepartment}
                         <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent" onClick={() => setSelectedDepartment('all')}>
                             <span className="sr-only">Remove</span>
                             <span className="text-xs">×</span>
                         </Button>
                     </Badge>
                 )}

                 <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                        setSelectedBrand('all');
                        setSelectedCategory('all');
                        setSelectedSupplier('all');
                        setSelectedWarehouse('all');
                        setSelectedShelfLocation('all');
                        setSelectedStatus('all');
                        setSelectedDepartment('all');
                        setSearchTerm('');
                    }}
                    className="h-8 text-xs text-muted-foreground"
                >
                    Clear All
                </Button>
            </div>
        )}
      </div>

      <Card className="border-0 shadow-lg bg-card/50 backdrop-blur-sm overflow-hidden flex flex-col flex-1 min-h-0">
        <CardContent className="p-0 overflow-hidden flex flex-col flex-1 min-h-0 relative">
        <TooltipProvider>
          <Table 
            className="text-xs" 
            wrapperClassName="flex-1"
          >
            <TableHeader className="z-20">
              <TableRow className="hover:bg-transparent border-b">
                <TableHead className="w-12 hidden sm:table-cell"><span className="sr-only">Expand</span></TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">SKU</TableHead>
                <TableHead className="hidden lg:table-cell">Barcode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell text-center">Unit</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="hidden md:table-cell text-right">Cost</TableHead>
                <TableHead className="hidden md:table-cell text-right">Retail Price</TableHead>
                <TableHead className="hidden md:table-cell text-center">Warehouse</TableHead>
                <TableHead className="hidden md:table-cell text-center">Shelf</TableHead>
                <TableHead>
                  Actions
                </TableHead>
              </TableRow>

            </TableHeader>
            <TableBody>
              {isLoadingProducts ? (
                Array.from({ length: 5 }).map((_, i) => <ProductSkeleton key={i} />)
              ) : (
                filteredProducts.map((product: ProductWithChildren) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    onProductDeleted={() => loadProducts(currentPage, pageSize)}
                    onProductUpdated={() => loadProducts(currentPage, pageSize)}
                    products={products}
                    productOptions={productOptions}
                    onOptionsRefresh={loadProductOptions}
                    lowStockThreshold={lowStockThreshold}
                  />
                ))
              )}
              {!isLoadingProducts && filteredProducts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center">
                    No products found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TooltipProvider>

      </CardContent>
      {/* Pagination Controls */}
      <div className="border-t bg-card/50 backdrop-blur-sm mt-auto">
        {totalProducts > 0 && (
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex-1 text-sm text-muted-foreground">
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalProducts)} of {totalProducts} products
            </div>
            <div className="flex items-center space-x-6">
              <div className="flex items-center space-x-2">
                <Label htmlFor="page-size" className="text-sm">Rows per page:</Label>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    const newSize = parseInt(value);
                    setPageSize(newSize);
                    setCurrentPage(1); // Reset to first page when changing page size
                  }}
                >
                  <SelectTrigger className="w-20" id="page-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <div className="text-sm font-medium">
                  Page {currentPage} of {Math.ceil(totalProducts / pageSize)}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalProducts / pageSize), prev + 1))}
                  disabled={currentPage === Math.ceil(totalProducts / pageSize)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      </Card>
    </div>
  );
}
