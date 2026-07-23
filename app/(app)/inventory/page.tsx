'use client';

import Link from 'next/link';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  LayoutGrid,
  List,
  Kanban,
  History,
  Layers,
  Rows3,
  PackageOpen,
} from 'lucide-react';

import { BatchInventoryDrawer } from './batch-inventory/BatchInventoryDrawer';
import { useInventoryPage } from './use-inventory-page';
import { ProductSkeleton } from './ProductSkeleton';
import { ProductGroup } from './ProductGroup';
import { ProductTableRowGroup } from './ProductTableRowGroup';

export default function InventoryPage() {
  const {
    searchTerm,
    handleSearch,
    handleClearSearch,
    sortBy,
    setSortBy,
    viewMode,
    setViewMode,
    typeFilter,
    handleTypeFilterChange,
    currentPage,
    setCurrentPage,
    pageSize,
    isBatchDrawerOpen,
    setIsBatchDrawerOpen,
    isLoading,
    products,
    pagedProducts,
    totalProducts,
    loadProducts,
    posSettings,
  } = useInventoryPage();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            Monitor and adjust stock levels across all products.
          </p>
        </div>
        <div className="flex items-center gap-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'grid' | 'list')}>
                <TabsList className="grid w-[120px] grid-cols-2">
                    <TabsTrigger value="grid"><LayoutGrid className="h-4 w-4" /></TabsTrigger>
                    <TabsTrigger value="list"><List className="h-4 w-4" /></TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="h-8 w-px bg-muted mx-1" />

            <div className="flex items-center gap-1 p-1.5 bg-muted/30 rounded-xl border border-border/50 shadow-sm ml-2 overflow-x-auto whitespace-nowrap scrollbar-none w-full md:w-auto">
                <Link href="/inventory/transfer-board">
                  <Button variant="ghost" size="sm" className="h-8 gap-2 hover:bg-muted font-medium px-3 flex-shrink-0">
                      <Kanban className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs">Transfer Board</span>
                  </Button>
                </Link>

                <div className="h-4 w-px bg-border/60 mx-1 flex-shrink-0" />

                <Link href="/inventory/shelf-board">
                  <Button variant="ghost" size="sm" className="h-8 gap-2 hover:bg-muted font-medium px-3 flex-shrink-0">
                      <Rows3 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs">Shelf Board</span>
                  </Button>
                </Link>

                <div className="h-4 w-px bg-border/60 mx-1 flex-shrink-0" />

                <Link href="/inventory/bulk-adjustment">
                  <Button variant="ghost" size="sm" className="h-8 gap-2 font-bold text-primary hover:text-primary hover:bg-primary/10 px-3 transition-colors flex-shrink-0">
                      <Layers className="h-4 w-4" />
                      <span className="text-xs">Bulk Adjustment</span>
                  </Button>
                </Link>

                <div className="h-4 w-px bg-border/60 mx-1 flex-shrink-0" />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsBatchDrawerOpen(true)}
                  className="h-8 gap-2 hover:bg-muted font-medium px-3 text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                    <PackageOpen className="h-4 w-4" />
                    <span className="text-xs">Stock Batches</span>
                </Button>

                <div className="h-4 w-px bg-border/60 mx-1 flex-shrink-0" />

                <Link href="/inventory/history">
                    <Button variant="ghost" size="sm" className="h-8 gap-2 hover:bg-muted font-medium px-3 text-muted-foreground hover:text-foreground flex-shrink-0">
                        <History className="h-4 w-4" />
                        <span className="text-xs">History</span>
                    </Button>
                </Link>
            </div>
        </div>
      </div>

      <BatchInventoryDrawer
        open={isBatchDrawerOpen}
        onOpenChange={setIsBatchDrawerOpen}
      />

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products by name or SKU..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'name' | 'stock' | 'sku')}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="stock">Stock Level</SelectItem>
            <SelectItem value="sku">SKU</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => handleTypeFilterChange(v as 'all' | 'standard' | 'service')}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Product type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="service">Service</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <ProductSkeleton key={i} />
          ))}
        </div>
      ) : products.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>No products found</CardTitle>
          <CardDescription>
            Try adjusting your search or filters to find what you're looking for.
          </CardDescription>
          <Button variant="outline" className="mt-4" onClick={handleClearSearch}>
            Clear Search
          </Button>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pagedProducts.map((product) => (
            <ProductGroup
              key={product.id}
              productGroup={product}
              onSuccess={loadProducts}
              requireAdjustmentConfirmation={posSettings?.requireAdjustmentConfirmation}
              requireTransferConfirmation={posSettings?.requireTransferConfirmation}
            />
          ))}
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reorder Pt</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedProducts.map((product) => (
                <ProductTableRowGroup
                  key={product.id}
                  productGroup={product}
                  onSuccess={loadProducts}
                  requireAdjustmentConfirmation={posSettings?.requireAdjustmentConfirmation}
                  requireTransferConfirmation={posSettings?.requireTransferConfirmation}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {!isLoading && products.length > 0 && (
        <div className="flex items-center justify-between mt-6">
            <p className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalProducts)} of {totalProducts} products
            </p>
            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                >
                    Previous
                </Button>
                <span className="text-sm font-medium">
                    Page {currentPage} of {Math.ceil(totalProducts / pageSize)}
                </span>
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
      )}
    </div>
  );
}
