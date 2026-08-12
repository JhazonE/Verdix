'use client';

import { TenderDialog } from '../tender/TenderDialog';
import { ProductSearchDialog } from '../product-search/ProductSearchDialog';
import { HeldTransactionsDialog } from '../held-transactions/HeldTransactionsDialog';
import { DiscountDialog } from '../discount/DiscountDialog';
import { SuspendNoteDialog } from '../suspend-note/SuspendNoteDialog';
import { AdminAuthDialog } from '../admin-auth/AdminAuthDialog';
import { EndShiftDialog } from '../end-shift/EndShiftDialog';
import { CashTransferDialog } from '../cash-transfer/CashTransferDialog';
import { CustomerAccountDialog } from '../customer-account/CustomerAccountDialog';
import { LoyaltyRewardsDialog } from '../loyalty-rewards/LoyaltyRewardsDialog';
import { RecentSalesDialog } from '../recent-sales/RecentSalesDialog';
import { VoidSalesDialog } from '../void-sales/VoidSalesDialog';
import { ReturnSalesDialog } from '../return-sales/ReturnSalesDialog';
import { PriceInquiryDialog } from '../price-inquiry/PriceInquiryDialog';
import { ZReadingDialog } from '../z-reading-report/ZReadingDialog';
import { ZReadingWarningDialog } from '../z-reading-warning/ZReadingWarningDialog';
import { XReadingDialog } from '../x-reading-report/XReadingDialog';
import { OverallReadingDialog } from '../overall-reading/OverallReadingDialog';
import { ShutdownConfirmationDialog } from '../shutdown-confirmation/ShutdownConfirmationDialog';
import { InsufficientStockDialog } from '../insufficient-stock/InsufficientStockDialog';
import { usePOS } from './use-pos';

type Props = ReturnType<typeof usePOS>;

export function PosDialogs(pos: Props) {
  return (
    <>
      <TenderDialog
        isOpen={pos.isTenderDialogOpen}
        onOpenChange={pos.setIsTenderDialogOpen}
        paymentMethod={pos.tenderMethod || ''}
        totalDue={pos.totalDue}
        items={pos.items}
        customer={pos.selectedCustomer}
        currentUser={pos.currentUser}
        onSuccess={pos.handleSuccessfulSale}
        shiftId={pos.currentShiftId}
        terminalId={pos.selectedTerminalId}
        terminalMin={pos.terminals?.find((t: any) => t.id === pos.selectedTerminalId)?.min}
        terminalSerialNumber={pos.terminals?.find((t: any) => t.id === pos.selectedTerminalId)?.serialNumber}
        terminalPermitNo={pos.terminals?.find((t: any) => t.id === pos.selectedTerminalId)?.permitNo}
        terminalAccreditationNo={pos.terminals?.find((t: any) => t.id === pos.selectedTerminalId)?.accreditationNo}
        terminalPermitDateIssued={pos.terminals?.find((t: any) => t.id === pos.selectedTerminalId)?.permitDateIssued}
        terminalName={pos.currentTerminalName}
        isTrainingMode={pos.isTrainingMode}
        paymentMethods={pos.paymentMethods}
        printMode={pos.businessSettings?.printMode || 'browser'}
        settings={pos.businessSettings as any}
        onTriggerCustomerSelection={() => pos.setIsCustomerSelectOpen(true)}
        onCheckoutComplete={pos.handleCheckoutComplete}
      />

      <ProductSearchDialog
        isOpen={pos.isProductSearchOpen}
        onOpenChange={(open) => { pos.setIsProductSearchOpen(open); if (!open) setTimeout(() => pos.inputRef.current?.focus(), 50); }}
        onSelectProduct={pos.handleAddItem}
        showQuantityInSearch={pos.showQuantityInSearch}
        activeLevelId={pos.activeLevelId}
        defaultLevelId={pos.defaultLevelId}
        activeLevelName={pos.activeLevelName}
        warehouseId={pos.inventoryLocation}
        allProducts={pos.products}
      />

      <DiscountDialog
        isOpen={pos.isDiscountDialogOpen}
        onOpenChange={pos.setIsDiscountDialogOpen}
        item={pos.selectedItem}
        onApplyDiscount={pos.handleApplyDiscount}
        hasItems={pos.items.length > 0}
      />

      <HeldTransactionsDialog
        isOpen={pos.isHeldTransOpen}
        onOpenChange={pos.setIsHeldTransOpen}
        heldTransactions={pos.heldTransactions}
        onRestore={pos.handleRestore}
        onDelete={pos.handleDeleteHeld}
      />

      <SuspendNoteDialog
        isOpen={pos.isSuspendNoteOpen}
        onOpenChange={pos.setIsSuspendNoteOpen}
        onConfirm={pos.confirmHold}
      />

      <AdminAuthDialog
        isOpen={pos.isPriceEditAuthOpen}
        onOpenChange={pos.setIsPriceEditAuthOpen}
        title="Price Edit Authorization"
        description="Please provide credentials to edit item price"
        requiredCredentials={pos.priceEditAuthCredentials}
        onSuccess={pos.handlePriceEditAuthSuccess}
        preventCloseAutoFocus
      />

      <AdminAuthDialog
        isOpen={pos.isEditItemAuthOpen}
        onOpenChange={pos.setIsEditItemAuthOpen}
        title="Edit Item Authorization"
        description="Please provide credentials to edit item name"
        requiredCredentials={pos.editItemAuthCredentials}
        onSuccess={pos.handleEditItemAuthSuccess}
        preventCloseAutoFocus
      />

      <AdminAuthDialog
        isOpen={pos.isSuspendAuthOpen}
        onOpenChange={pos.setIsSuspendAuthOpen}
        title="Suspend Authorization"
        description="Please provide credentials to suspend a transaction"
        requiredCredentials={pos.suspendAuthCredentials}
        onSuccess={pos.handleSuspendAuthSuccess}
        preventCloseAutoFocus
      />

      <AdminAuthDialog
        isOpen={pos.isSuspendedAuthOpen}
        onOpenChange={pos.setIsSuspendedAuthOpen}
        title="Suspended Authorization"
        description="Please provide credentials to view suspended transactions"
        requiredCredentials={pos.suspendedAuthCredentials}
        onSuccess={pos.handleSuspendedAuthSuccess}
        preventCloseAutoFocus
      />

      <AdminAuthDialog
        isOpen={pos.isLineVoidAuthOpen}
        onOpenChange={pos.setIsLineVoidAuthOpen}
        title="Authorization Required"
        description="Please provide credentials to Void Line Items"
        requiredCredentials={pos.lineVoidAuthCredentials}
        onSuccess={() => { pos.setIsLineVoidAuthOpen(false); if (pos.pendingVoidItemId) pos.performVoidLine(pos.pendingVoidItemId); }}
      />

      <AdminAuthDialog
        isOpen={pos.isOverallReadingAuthOpen}
        onOpenChange={pos.setIsOverallReadingAuthOpen}
        title="Overall Reading Authorization"
        description="Please provide credentials to view Overall Terminal Reading"
        requiredCredentials={pos.overallReadingAuthCredentials}
        onSuccess={() => { pos.setIsOverallReadingAuthOpen(false); pos.setIsOverallReadingOpen(true); }}
      />

      <EndShiftDialog
        isOpen={pos.isEndShiftOpen}
        onOpenChange={pos.setIsEndShiftOpen}
        startingCash={pos.startingCash}
        cashSales={pos.cashSales}
        membershipCash={pos.membershipCash}
        cashIn={pos.cashDeposits}
        cashOut={pos.cashPickups}
        onShiftEnd={pos.handleConfirmEndShift}
      />

      <CashTransferDialog
        isOpen={pos.isCashTransferOpen}
        onOpenChange={pos.setIsCashTransferOpen}
        shiftId={pos.currentShiftId}
        terminalId={pos.selectedTerminalId}
        userId={pos.currentUser?.uid || pos.currentUser?.id || ''}
      />

      <CustomerAccountDialog
        isOpen={pos.isCustomerSelectOpen}
        onOpenChange={pos.setIsCustomerSelectOpen}
        onSelectCustomer={pos.handleSelectCustomer}
        initialCustomer={pos.selectedCustomer}
        printMode={pos.businessSettings?.printMode || 'native'}
        settings={pos.businessSettings as any}
        posUserId={pos.currentUser?.uid || pos.currentUser?.id || ''}
        posCashierName={pos.currentUser?.displayName || pos.currentUser?.name}
        posShiftId={pos.currentShiftId}
        posTerminalId={pos.selectedTerminalId}
      />

      <LoyaltyRewardsDialog
        isOpen={pos.isLoyaltyOpen}
        onOpenChange={pos.setIsLoyaltyOpen}
        customer={pos.selectedCustomer}
      />

      <RecentSalesDialog
        isOpen={pos.isRecentSalesOpen}
        onOpenChange={pos.setIsRecentSalesOpen}
        printMode={pos.businessSettings?.printMode || 'browser'}
        settings={pos.businessSettings as any}
      />

      <VoidSalesDialog isOpen={pos.isVoidSalesOpen} onOpenChange={pos.setIsVoidSalesOpen} />

      <ReturnSalesDialog
        isOpen={pos.isReturnSalesOpen}
        onOpenChange={pos.setIsReturnSalesOpen}
        currentUser={pos.currentUser}
        terminalId={pos.selectedTerminalId}
        printMode={pos.businessSettings?.printMode || 'browser'}
      />

      <PriceInquiryDialog
        isOpen={pos.isPriceInquiryOpen}
        onOpenChange={pos.setIsPriceInquiryOpen}
        activeLevelId={pos.activeLevelId}
        defaultLevelId={pos.defaultLevelId}
        activeLevelName={pos.activeLevelName}
      />

      <ZReadingDialog
        isOpen={pos.isZReadingOpen}
        onOpenChange={pos.setIsZReadingOpen}
        printMode={pos.businessSettings?.printMode || 'browser'}
        terminalId={pos.selectedTerminalId}
        terminalName={pos.currentTerminalName}
        autoShow={false}
        initialData={pos.lastSavedZReading}
      />

      <ZReadingWarningDialog
        open={pos.isZReadingWarningOpen}
        onOpenChange={pos.setIsZReadingWarningOpen}
        onConfirm={pos.handleConfirmZReadingWarning}
      />

      <OverallReadingDialog
        isOpen={pos.isOverallReadingOpen}
        onOpenChange={(open) => { pos.setIsOverallReadingOpen(open); if (!open) pos.setPendingOverallReading(false); }}
        terminalId={pos.selectedTerminalId || 'all'}
        terminalName={pos.currentTerminalName || 'All Terminals'}
        printMode={pos.businessSettings?.printMode || 'browser'}
      />

      <XReadingDialog
        isOpen={pos.showEndShiftReport}
        onOpenChange={pos.setShowEndShiftReport}
        shiftId={pos.lastEndedShiftId ?? undefined}
        terminalName={pos.currentTerminalName}
        autoShow={true}
        printMode={pos.businessSettings?.printMode || 'browser'}
      />

      <XReadingDialog
        isOpen={pos.isXReadingOpen}
        onOpenChange={pos.setIsXReadingOpen}
        shiftId={pos.currentShiftId ?? undefined}
        terminalName={pos.currentTerminalName}
        printMode={pos.businessSettings?.printMode || 'browser'}
      />

      <ShutdownConfirmationDialog
        open={pos.isShutdownConfirmOpen}
        onOpenChange={pos.setIsShutdownConfirmOpen}
        onConfirm={pos.handleLogout}
      />

      <InsufficientStockDialog
        open={pos.isInsufficientStockOpen}
        onOpenChange={pos.setIsInsufficientStockOpen}
        items={pos.insufficientItems}
      />
    </>
  );
}









