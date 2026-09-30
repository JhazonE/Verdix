'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { User, Loader2, Search, CreditCard, Printer, Hash, StickyNote, Phone, MapPin, Tag, Wallet, TrendingUp, Landmark, Coins, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format, differenceInDays } from 'date-fns';
import { useCustomerAccount } from './use-customer-account';
import type { CustomerAccountDialogProps } from './customer-account-types';
import { MembershipPaymentDialog } from '../membership/MembershipPaymentDialog';
import { AddCustomerDialog } from '../add-customer/AddCustomerDialog';

export { WALK_IN_CUSTOMER } from './customer-account-types';

export function CustomerAccountDialog({ isOpen, onOpenChange, onSelectCustomer, initialCustomer, printMode = 'native', settings, posUserId, posCashierName, posShiftId, posTerminalId }: CustomerAccountDialogProps) {
  const {
    customers, selectedCustomerId, setSelectedCustomerId,
    customerDetails, isDetailsLoading,
    transactions, payments,
    isPaymentDialogOpen, setIsPaymentDialogOpen,
    paymentAmount, setPaymentAmount,
    paymentType, setPaymentType,
    paymentReference, setPaymentReference,
    paymentNote, setPaymentNote,
    isSubmittingPayment,
    activeInvoiceBalance,
    overpaymentMode, setOverpaymentMode,
    lastPaymentData,
    showPrintPrompt, setShowPrintPrompt,
    rfidInput, setRfidInput,
    isRfidSearching, rfidError,
    rfidInputRef, yesButtonRef, noButtonRef,
    fetchCustomers,
    handlePrintPaymentReceipt,
    handleSubmitPayment,
    handlePaySpecific,
    handleRfidSearch,
    handleSelect,
    handlePrintPromptKeyDown,
    formatCurrency,
    getInitials,
    allItems, pendingCharges, overdueCharges,
    membershipCard, isMembershipCardLoading, isMembershipDialogOpen, setIsMembershipDialogOpen, fetchMembershipCard,
    isAddCustomerOpen, setIsAddCustomerOpen, handleCustomerAdded,
  } = useCustomerAccount({ isOpen, onOpenChange, onSelectCustomer, initialCustomer, printMode, settings });

  const enableQuickAddCustomer = settings?.enableQuickAddCustomer !== false;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="top" className="h-[88vh] max-h-[88vh] w-full overflow-hidden flex flex-col p-6 rounded-b-2xl">
          <SheetHeader>
            <SheetTitle className="sr-only">Customer Account Dialog</SheetTitle>
            <SheetDescription className="sr-only">
              View and manage customer account details, credit status, and transaction history.
            </SheetDescription>
            <div className="flex justify-between items-start">
              <div className="space-y-4 w-full">
                <div className="flex items-end gap-3">
                  {/* RFID / Loyalty Card Search */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-1">RFID / Loyalty Card</p>
                    <div className="flex items-center gap-2">
                      <Input
                        ref={rfidInputRef}
                        placeholder="Scan or type RFID / card number..."
                        value={rfidInput}
                        onChange={(e) => { setRfidInput(e.target.value); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleRfidSearch(); }}
                        className="w-full"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 shrink-0"
                        onClick={handleRfidSearch}
                        disabled={isRfidSearching || !rfidInput.trim()}
                        title="Search by RFID"
                      >
                        {isRfidSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      </Button>
                    </div>
                    {rfidError && <p className="text-xs text-destructive mt-1">{rfidError}</p>}
                  </div>

                  {/* Customer Selection */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium mb-1">Customer</p>
                    <div className="flex items-center gap-2">
                      <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Select Customer" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="walk-in">Walk-in Customer</SelectItem>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {enableQuickAddCustomer && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 shrink-0"
                          onClick={() => setIsAddCustomerOpen(true)}
                          title="Add Customer"
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedCustomerId !== 'walk-in' && (
                    <Avatar className="h-16 w-16 shrink-0">
                      <AvatarFallback className="text-xl bg-muted">{getInitials(customerDetails?.name || '')}</AvatarFallback>
                    </Avatar>
                  )}
                </div>

                {selectedCustomerId !== 'walk-in' && customerDetails && (
                  <div className="flex gap-4">
                    <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3">
                      {[
                        { icon: Tag,    label: 'Code',      value: customerDetails.id },
                        { icon: User,   label: 'Full Name', value: customerDetails.name },
                        { icon: Phone,  label: 'Contact',   value: customerDetails.contact_number || 'N/A' },
                        { icon: MapPin, label: 'Address',   value: customerDetails.address || 'N/A' },
                      ].map(({ icon: Icon, label, value }) => (
                        <div key={label} className="flex items-start gap-2 min-w-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">{label}</p>
                            <p className="text-sm font-medium truncate">{value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {(customerDetails.credit_balance || 0) > 0 && (
                      <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 shrink-0">
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-emerald-600" /><p className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Available Credit</p></div>
                          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(customerDetails.credit_balance || 0)}</p>
                        </CardContent>
                      </Card>
                    )}
                    <div className="grid grid-cols-2 gap-2 shrink-0">
                      <Card className="border bg-muted/40">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-1.5 mb-1"><Landmark className="h-3 w-3 text-muted-foreground" /><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Credit Limit</p></div>
                          <p className="text-sm font-bold">{formatCurrency(customerDetails.credit_limit || 0)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border bg-muted/40">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-1.5 mb-1"><TrendingUp className="h-3 w-3 text-muted-foreground" /><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Credit Sales</p></div>
                          <p className="text-sm font-bold">{formatCurrency(customerDetails.credit_sales || 0)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border bg-muted/40">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-1.5 mb-1"><Wallet className="h-3 w-3 text-muted-foreground" /><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Payment</p></div>
                          <p className="text-sm font-bold">{formatCurrency(customerDetails.total_payment || 0)}</p>
                        </CardContent>
                      </Card>
                      <Card className="border bg-cyan-50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-1.5 mb-1"><CreditCard className="h-3 w-3 text-cyan-500" /><p className="text-[10px] text-cyan-600 dark:text-cyan-400 uppercase tracking-wide">Balance</p></div>
                          <p className="text-sm font-bold text-cyan-600 dark:text-cyan-400">{formatCurrency(customerDetails.balance || 0)}</p>
                        </CardContent>
                      </Card>
                    </div>
                    <Card className="border bg-muted/40 shrink-0 min-w-[200px]">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <CreditCard className="h-3.5 w-3.5 text-amber-600" />
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Membership</p>
                        </div>
                        {isMembershipCardLoading ? (
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Checking…</p>
                        ) : membershipCard ? (
                          <>
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${membershipCard.isExpired ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {membershipCard.isExpired ? 'Expired' : 'Active'}
                            </span>
                            <p className="text-xs">RFID: <span className="font-mono">{membershipCard.rfid_code || '—'}</span></p>
                            <p className="text-xs text-muted-foreground">{membershipCard.expiry_date ? `Valid until ${format(new Date(membershipCard.expiry_date), 'MMM dd, yyyy')}` : 'No expiry'}</p>
                          </>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-muted text-muted-foreground">No Card</span>
                        )}
                        <Button
                          size="sm"
                          className="w-full h-8 bg-amber-600 hover:bg-amber-700"
                          onClick={() => setIsMembershipDialogOpen(true)}
                        >
                          {membershipCard ? (membershipCard.isExpired ? 'Renew Membership' : 'Renew Membership') : 'Activate Membership'}
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {selectedCustomerId === 'walk-in' && !isDetailsLoading && (
                  <div className="p-8 text-center text-muted-foreground italic border rounded-lg bg-muted/30">
                    Walk-in customers do not have detailed transaction or credit history tracking.
                  </div>
                )}
              </div>
            </div>
          </SheetHeader>

          <div className="mt-4 flex-grow overflow-hidden flex flex-col">
            <Tabs defaultValue="transactions" className="w-full flex-grow flex flex-col">
              <TabsList className="justify-start border-b rounded-none bg-transparent h-auto p-0 mb-2">
                <TabsTrigger value="transactions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Transaction Detail</TabsTrigger>
                <TabsTrigger value="charges" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Charges Detail</TabsTrigger>
                <TabsTrigger value="overdue" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Overdue</TabsTrigger>
                <TabsTrigger value="payments" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Payment Detail</TabsTrigger>
                <TabsTrigger value="pending" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2">Pending Charges</TabsTrigger>
              </TabsList>

              <div className="flex-grow overflow-auto border rounded-md bg-card">
                <TabsContent value="transactions" className="m-0">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Description</TableHead><TableHead>Price</TableHead><TableHead>Qty</TableHead>
                        <TableHead>Total</TableHead><TableHead>Discount</TableHead><TableHead>Transaction Date</TableHead><TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isDetailsLoading ? (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto mr-2 inline-block" />Loading transaction data...</TableCell></TableRow>
                      ) : allItems.length > 0 ? (
                        allItems.map((item: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{item.product.name}</TableCell>
                            <TableCell>{formatCurrency(item.price)}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>{formatCurrency(item.price * item.quantity)}</TableCell>
                            <TableCell>{formatCurrency(item.discountTotal || 0)}</TableCell>
                            <TableCell>{format(new Date(item.transactionDate), 'MMM dd, yyyy')}</TableCell>
                            <TableCell>{item.status}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No transactions found.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="payments" className="m-0">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isDetailsLoading ? (
                        <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto mr-2 inline-block" />Loading payment history...</TableCell></TableRow>
                      ) : payments.length > 0 ? (
                        payments.map((payment: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell>{format(new Date(payment.paymentDate), 'MMM dd, yyyy')}</TableCell>
                            <TableCell>{payment.reference}</TableCell>
                            <TableCell>{payment.paymentType}</TableCell>
                            <TableCell>{formatCurrency(payment.amount)}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{payment.note}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No payments found.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="charges" className="m-0">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Total Amount</TableHead>
                        <TableHead>Paid Amount</TableHead><TableHead>Balance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isDetailsLoading ? (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto mr-2 inline-block" />Loading charges...</TableCell></TableRow>
                      ) : transactions.length > 0 ? (
                        transactions.map((sale: any, idx: number) => {
                          // A 'Paid' sale is settled even if amount_paid was never recorded (e.g. older POS sales).
                          const effectivePaid = sale.status === 'Paid' ? sale.total : (sale.paidAmount || 0);
                          const balance = Math.max(0, sale.total - effectivePaid);
                          return (
                          <TableRow key={idx}>
                            <TableCell>{format(new Date(sale.date), 'MMM dd, yyyy')}</TableCell>
                            <TableCell className="font-medium text-primary">{sale.orderNumber || sale.receiptNo || sale.id.substring(0, 8)}</TableCell>
                            <TableCell>{formatCurrency(sale.total)}</TableCell>
                            <TableCell>{formatCurrency(effectivePaid)}</TableCell>
                            <TableCell className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-green-600'}`}>{formatCurrency(balance)}</TableCell>
                            <TableCell>
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${sale.status === 'Paid' ? 'bg-green-100 text-green-700' : sale.status === 'Voided' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {sale.status}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              {balance > 0 && sale.status !== 'Voided' && (
                                <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => handlePaySpecific(sale)}>Pay</Button>
                              )}
                            </TableCell>
                          </TableRow>
                          );
                        })
                      ) : (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No charge history found.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="overdue" className="m-0">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Due Date</TableHead>
                        <TableHead>Total Amount</TableHead><TableHead>Balance</TableHead><TableHead>Days Overdue</TableHead><TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isDetailsLoading ? (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto mr-2 inline-block" />Checking overdue status...</TableCell></TableRow>
                      ) : overdueCharges.length > 0 ? (
                        overdueCharges.map((sale: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell>{format(new Date(sale.date), 'MMM dd, yyyy')}</TableCell>
                            <TableCell className="font-medium text-primary">{sale.orderNumber || sale.receiptNo || sale.id.substring(0, 8)}</TableCell>
                            <TableCell className="text-red-500 font-medium">{format(new Date(sale.dueDate!), 'MMM dd, yyyy')}</TableCell>
                            <TableCell>{formatCurrency(sale.total)}</TableCell>
                            <TableCell className="font-bold text-red-500">{formatCurrency(sale.total - (sale.paidAmount || 0))}</TableCell>
                            <TableCell>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                {differenceInDays(new Date(), new Date(sale.dueDate!))} days
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handlePaySpecific(sale)}>Pay</Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No overdue charges found.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>

                <TabsContent value="pending" className="m-0">
                  <Table>
                    <TableHeader className="bg-muted/50 sticky top-0">
                      <TableRow>
                        <TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Due Date</TableHead>
                        <TableHead>Total Amount</TableHead><TableHead>Balance</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isDetailsLoading ? (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto mr-2 inline-block" />Loading pending records...</TableCell></TableRow>
                      ) : pendingCharges.length > 0 ? (
                        pendingCharges.map((sale: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell>{format(new Date(sale.date), 'MMM dd, yyyy')}</TableCell>
                            <TableCell className="font-medium text-primary">{sale.orderNumber || sale.receiptNo || sale.id.substring(0, 8)}</TableCell>
                            <TableCell>{sale.dueDate ? format(new Date(sale.dueDate), 'MMM dd, yyyy') : 'N/A'}</TableCell>
                            <TableCell>{formatCurrency(sale.total)}</TableCell>
                            <TableCell className="font-bold text-amber-600">{formatCurrency(sale.total - (sale.paidAmount || 0))}</TableCell>
                            <TableCell>
                              <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700">{sale.status}</span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => handlePaySpecific(sale)}>Pay</Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No pending charges found.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TabsContent>
              </div>
            </Tabs>
          </div>

          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSelect}>Confirm Selection</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Payment Sub-Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={(open) => {
        if (!open) { setIsPaymentDialogOpen(false); onOpenChange(true); }
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Make Charge Payment</DialogTitle>
            <DialogDescription>
              Record a payment for {customerDetails?.name || 'customer'}. This will decrease their outstanding balance.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="amount" className="text-sm font-medium">Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center text-sm font-semibold leading-none text-muted-foreground pointer-events-none">₱</span>
                <Input id="amount" type="number" placeholder="0.00" className="pl-9" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} autoFocus />
              </div>
              {activeInvoiceBalance > 0 && (
                <p className="text-xs text-muted-foreground">Outstanding balance: {formatCurrency(activeInvoiceBalance)}</p>
              )}
            </div>

            {(() => {
              const overpayment = Math.max(0, (parseFloat(paymentAmount) || 0) - (activeInvoiceBalance || 0));
              if (overpayment <= 0) return null;
              return (
                <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-800">
                    Overpayment of {formatCurrency(overpayment)} detected.
                  </p>
                  <p className="text-xs text-amber-700">Choose how to handle the excess:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={overpaymentMode === 'change' ? 'default' : 'outline'}
                      className={overpaymentMode === 'change' ? 'bg-amber-600 hover:bg-amber-700 h-auto py-2' : 'h-auto py-2'}
                      onClick={() => setOverpaymentMode('change')}
                    >
                      <div className="flex flex-col items-center">
                        <Coins className="h-4 w-4 mb-1" />
                        <span className="text-xs font-medium">Give Change</span>
                      </div>
                    </Button>
                    <Button
                      type="button"
                      variant={overpaymentMode === 'credit' ? 'default' : 'outline'}
                      className={overpaymentMode === 'credit' ? 'bg-emerald-600 hover:bg-emerald-700 h-auto py-2' : 'h-auto py-2'}
                      onClick={() => setOverpaymentMode('credit')}
                    >
                      <div className="flex flex-col items-center">
                        <Wallet className="h-4 w-4 mb-1" />
                        <span className="text-xs font-medium">Keep as Credit</span>
                      </div>
                    </Button>
                  </div>
                  <p className="text-xs text-amber-700">
                    {overpaymentMode === 'change'
                      ? `Hand back ${formatCurrency(overpayment)} as change. Only ${formatCurrency(activeInvoiceBalance)} is recorded.`
                      : `${formatCurrency(overpayment)} will be kept as account credit usable for future charges.`}
                  </p>
                </div>
              );
            })()}

            <div className="grid gap-1.5">
              <Label htmlFor="type" className="text-sm font-medium">Payment Type</Label>
              <Select value={paymentType} onValueChange={setPaymentType}>
                <SelectTrigger id="type"><SelectValue placeholder="Payment Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Check">Check</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="E-Wallet">E-Wallet</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ref" className="text-sm font-medium">Reference #</Label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input id="ref" placeholder="Check # or Ref #" className="pl-9" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notes" className="text-sm font-medium">Notes</Label>
              <div className="relative">
                <StickyNote className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input id="notes" placeholder="Optional notes" className="pl-9" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitPayment} disabled={isSubmittingPayment} className="bg-emerald-600 hover:bg-emerald-700">
              {isSubmittingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Prompt */}
      <Dialog open={showPrintPrompt} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[360px]" onInteractOutside={(e) => e.preventDefault()} onKeyDown={handlePrintPromptKeyDown}>
          <DialogHeader>
            <DialogTitle>Print Receipt?</DialogTitle>
            <DialogDescription>
              Would you like to print a payment receipt for {customerDetails?.name || 'this customer'}?
            </DialogDescription>
          </DialogHeader>
          <div className="text-center py-2">
            <p className="text-2xl font-black text-emerald-600">{lastPaymentData ? formatCurrency(lastPaymentData.amount) : ''}</p>
            <p className="text-sm text-muted-foreground">{lastPaymentData?.paymentType}</p>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="lg"
              ref={noButtonRef}
              onClick={() => { setShowPrintPrompt(false); onOpenChange(true); }}
            >
              No
            </Button>
            <Button
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700"
              ref={yesButtonRef}
              autoFocus
              onClick={async () => {
                if (lastPaymentData) await handlePrintPaymentReceipt(lastPaymentData);
                setShowPrintPrompt(false);
                onOpenChange(true);
              }}
            >
              <Printer className="mr-2 h-4 w-4" /> Yes, Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {enableQuickAddCustomer && (
        <AddCustomerDialog
          isOpen={isAddCustomerOpen}
          onOpenChange={setIsAddCustomerOpen}
          onCustomerAdded={handleCustomerAdded}
        />
      )}

      <MembershipPaymentDialog
        isOpen={isMembershipDialogOpen}
        onOpenChange={(open) => {
          setIsMembershipDialogOpen(open);
          if (!open) fetchMembershipCard();
        }}
        initialCustomer={customerDetails ? { id: customerDetails.id, name: customerDetails.name } as any : null}
        printMode={printMode}
        settings={settings}
        userId={posUserId || ''}
        cashierName={posCashierName}
        shiftId={posShiftId}
        terminalId={posTerminalId}
      />
    </>
  );
}
