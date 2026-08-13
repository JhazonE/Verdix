'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosLoginForm } from './login-form/PosLoginForm';
import { StartShiftDialog } from './start-shift/StartShiftDialog';
import { ShiftTakeoverDialog } from './shift-takeover/ShiftTakeoverDialog';
import { AdminAuthDialog } from './admin-auth/AdminAuthDialog';
import { PosHeader } from './pos-content/PosHeader';
import { PosCartTable } from './pos-content/PosCartTable';
import { PosFooterActions } from './pos-content/PosFooterActions';
import { PosTotalsPanel } from './pos-content/PosTotalsPanel';
import { PosDialogs } from './pos-content/PosDialogs';
import { PosQueuePanel } from './pos-content/PosQueuePanel';
import { SendToQueueDialog } from './pos-content/SendToQueueDialog';
import { FrontlinerModePrompt } from './pos-content/FrontlinerModePrompt';
import { usePOS } from './pos-content/use-pos';

// Re-export types used by sibling dialog files
export type { SaleItem, SuspendedTransaction } from './pos-content/pos-types';
export { mapVatStatusToTaxType } from './pos-content/pos-types';

const queryClient = new QueryClient();

export default function POSPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <POSContent />
    </QueryClientProvider>
  );
}

function POSContent() {
  const pos = usePOS();

  return (
    <>
      <div className="flex h-screen w-screen bg-muted/30 font-sans overflow-hidden">
        <AdminAuthDialog
          isOpen={pos.isCashCountAuthOpen}
          onOpenChange={pos.setIsCashCountAuthOpen}
          onSuccess={() => pos.setIsEndShiftOpen(true)}
          requiredCredentials={pos.cashCountAuthCredentials}
          title="Cash Count Authentication"
          description="Please enter credentials to access Cash Count."
        />

        <AdminAuthDialog
          isOpen={pos.isCashTransferPreAuthOpen}
          onOpenChange={pos.setIsCashTransferPreAuthOpen}
          onSuccess={() => { pos.setIsCashTransferPreAuthOpen(false); pos.setIsCashTransferOpen(true); }}
          requiredCredentials={{ username: pos.businessSettings?.cashTransferAuthUsername, password: pos.businessSettings?.cashTransferAuthPassword }}
          title="Cash Transfer Authentication"
          description="Please enter credentials to process a cash transfer."
        />

        {/* Left: Transaction Area */}
        <div className="flex-1 flex flex-col relative min-w-0">
          {pos.showOverlay && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-md z-20 flex items-center justify-center p-8">
              <div className="max-w-md text-center space-y-4 animate-fade-in">
                <h1 className="text-4xl font-bold tracking-tight text-foreground">POS Locked</h1>
                <p className="text-muted-foreground">Please log in and start a shift to continue.</p>
              </div>
            </div>
          )}

          <PosHeader
            selectedItemId={pos.selectedItemId}
            shiftActive={pos.shiftActive}
            heldTransactions={pos.heldTransactions}
            currentTerminalName={pos.currentTerminalName}
            currentTime={pos.currentTime}
            enableCustomerDisplay={pos.enableCustomerDisplay}
            openOnSecondScreen={pos.openOnSecondScreen}
            handleOpenEditDialog={pos.handleOpenEditDialog}
            handleVoidLine={pos.handleVoidLine}
            handleOpenDiscountDialog={pos.handleOpenDiscountDialog}
            handleHold={pos.handleHold}
            handleOpenSuspended={pos.handleOpenSuspended}
            focusInlineQuantity={pos.focusInlineQuantity}
            handleRequestPriceEdit={pos.handleRequestPriceEdit}
            handleShutdown={pos.handleShutdown}
            isFrontliner={pos.isFrontliner}
            posMode={pos.businessSettings?.posMode}
            queuedOrdersCount={pos.queuedOrders.length}
            setIsQueuePanelOpen={pos.setIsQueuePanelOpen}
          />

          <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
            <PosCartTable
              inputRef={pos.inputRef}
              inputValue={pos.inputValue}
              setInputValue={pos.setInputValue}
              handleAddItemBySKU={pos.handleAddItemBySKU}
              getSearchSuggestions={pos.getSearchSuggestions}
              handleAddItem={pos.handleAddItem}
              handleDefaultTender={pos.handleDefaultTender}
              setIsProductSearchOpen={pos.setIsProductSearchOpen}
              items={pos.items}
              selectedItemId={pos.selectedItemId}
              setSelectedItemId={pos.setSelectedItemId}
              editingNameItemId={pos.editingNameItemId}
              setEditingNameItemId={pos.setEditingNameItemId}
              editingQtyItemId={pos.editingQtyItemId}
              setEditingQtyItemId={pos.setEditingQtyItemId}
              editingPriceItemId={pos.editingPriceItemId}
              setEditingPriceItemId={pos.setEditingPriceItemId}
              qtyDraft={pos.qtyDraft}
              setQtyDraft={pos.setQtyDraft}
              startEditName={pos.startEditName}
              commitInlineName={pos.commitInlineName}
              requestInlinePriceEdit={pos.requestInlinePriceEdit}
              commitInlinePrice={pos.commitInlinePrice}
              focusInlineQuantity={pos.focusInlineQuantity}
              commitQty={pos.commitQty}
              isFrontliner={pos.isFrontliner}
              handleSendToQueue={pos.handleSendToQueue}
            />
            <PosFooterActions
              handleOpenEndShift={pos.handleOpenEndShift}
              handleOpenCashTransfer={pos.handleOpenCashTransfer}
              setIsCustomerSelectOpen={pos.setIsCustomerSelectOpen}
              handleOpenLoyalty={pos.handleOpenLoyalty}
              setIsRecentSalesOpen={pos.setIsRecentSalesOpen}
              setIsVoidSalesOpen={pos.setIsVoidSalesOpen}
              setIsReturnSalesOpen={pos.setIsReturnSalesOpen}
              setIsPriceInquiryOpen={pos.setIsPriceInquiryOpen}
              isFrontliner={pos.isFrontliner}
            />
          </div>
        </div>

        {/* Right: Totals Panel */}
        <PosTotalsPanel
          businessSettings={pos.businessSettings}
          currentTerminalName={pos.currentTerminalName}
          currentUser={pos.currentUser}
          selectedCustomer={pos.selectedCustomer}
          handleSelectCustomer={pos.handleSelectCustomer}
          setIsCustomerSelectOpen={pos.setIsCustomerSelectOpen}
          totalDue={pos.totalDue}
          numberOfItems={pos.numberOfItems}
          subTotal={pos.subTotal}
          vatSales={pos.vatSales}
          vatAmount={pos.vatAmount}
          taxDetails={pos.taxDetails}
          items={pos.items}
          handleDefaultTender={pos.handleDefaultTender}
          isFrontliner={pos.isFrontliner}
          handleSendToQueue={pos.handleSendToQueue}
          posMode={pos.businessSettings?.posMode}
        />
      </div>

      {!pos.isPosLoggedIn && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in">
          <PosLoginForm onLoginSuccess={pos.handlePosLoginSuccess} />
        </div>
      )}

      {pos.isPosLoggedIn && !pos.shiftActive && !pos.isCheckingShift && !pos.isCollisionOpen && !pos.isFrontliner && (
        <StartShiftDialog
          isOpen={true}
          onShiftStart={pos.handleStartShift}
          onCancel={pos.handleLogout}
        />
      )}

      {pos.isCollisionOpen && pos.collisionShift && (
        <ShiftTakeoverDialog
          isOpen={pos.isCollisionOpen}
          previousCashierName={pos.collisionShift.cashierName || 'Previous Cashier'}
          onContinue={pos.handleContinueShift}
          onStartNew={pos.handleTakeoverStartNew}
        />
      )}

      <PosDialogs {...pos} />

      <SendToQueueDialog
        open={pos.isSendToQueueOpen}
        onOpenChange={pos.setIsSendToQueueOpen}
        items={pos.items}
        defaultCustomerName={pos.selectedCustomer?.name || 'Walk-in'}
        totalDue={pos.totalDue}
        currencySymbol={pos.businessSettings?.currencySymbol}
        onConfirm={pos.handleConfirmSendToQueue}
      />

      <PosQueuePanel
        open={pos.isQueuePanelOpen}
        onOpenChange={pos.setIsQueuePanelOpen}
        queuedOrders={pos.queuedOrders}
        onClaimOrder={pos.handleClaimQueuedOrder}
        currencySymbol={pos.businessSettings?.currencySymbol}
      />

      <FrontlinerModePrompt
        open={pos.isFrontlinerPromptOpen}
        blocked={pos.isFrontlinerBlocked}
        userName={pos.currentUser?.name || pos.currentUser?.username}
        onOpenChange={pos.setIsFrontlinerPromptOpen}
      />
    </>
  );
}




