'use client';

import { Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useTransferBoard } from './use-transfer-board';
import { SourcePane } from './source-pane';
import { TargetPane } from './target-pane';

export function TransferBoard() {
  const {
    mounted,
    isLoading,
    isSearching,
    warehouses,
    fetchData,
    sourceSearch,
    setSourceSearch,
    selectedSourceIds,
    toggleSelectItem,
    toggleSelectAll,
    filteredSourceItems,
    stageItems,
    targetWarehouseId,
    setTargetWarehouseId,
    stagedItems,
    removeStagedItem,
    updateStagedQuantity,
    clearStaged,
    isTransferring,
    executeTransfer,
    activeTab,
    setActiveTab,
  } = useTransferBoard();

  // isLoading is raised only by the initial load (see use-transfer-board's
  // fetchProducts), so this full-screen swap can never fire mid-search and
  // unmount the search input the user is typing into.
  if (!mounted || isLoading) {
    return (
      <div className="p-10 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const sourcePaneProps = {
    sourceSearch,
    onSearchChange: setSourceSearch,
    isSearching,
    filteredSourceItems,
    selectedSourceIds,
    onToggleSelectItem: toggleSelectItem,
    onToggleSelectAll: toggleSelectAll,
    onStageSelected: () => stageItems(selectedSourceIds),
    onStageItem: (id: string) => stageItems(id),
    // Wrapped so no caller-supplied argument can land in fetchData's `search`
    // parameter and silently filter the product list.
    onWarehouseChange: () => fetchData(sourceSearch),
  };

  const targetPaneProps = {
    warehouses,
    targetWarehouseId,
    onTargetWarehouseChange: setTargetWarehouseId,
    stagedItems,
    onUpdateQuantity: updateStagedQuantity,
    onRemoveItem: removeStagedItem,
    onClearAll: clearStaged,
    onExecuteTransfer: executeTransfer,
    isTransferring,
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Desktop: side-by-side */}
      <div className="hidden lg:grid grid-cols-2 gap-6 h-full p-4">
        <div className="border rounded-2xl overflow-hidden shadow-sm">
          <SourcePane {...sourcePaneProps} />
        </div>
        <div className="border rounded-2xl overflow-hidden shadow-sm">
          <TargetPane {...targetPaneProps} />
        </div>
      </div>

      {/* Mobile: tabbed */}
      <div className="flex lg:hidden flex-col h-full w-full overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full w-full">
          <div className="px-3 pt-2 shrink-0">
            <TabsList className="grid grid-cols-2 w-full h-10 p-1 bg-muted/60 rounded-lg">
              <TabsTrigger value="source" className="text-xs font-bold">
                Stock Pool {stagedItems.length > 0 && `(${stagedItems.length})`}
              </TabsTrigger>
              <TabsTrigger value="staging" className="text-xs font-bold">
                Staging Area
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="source" className="flex-1 m-0 min-h-0 data-[state=active]:flex flex-col">
            <SourcePane {...sourcePaneProps} />
          </TabsContent>
          <TabsContent value="staging" className="flex-1 m-0 min-h-0 data-[state=active]:flex flex-col relative">
            <TargetPane {...targetPaneProps} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
