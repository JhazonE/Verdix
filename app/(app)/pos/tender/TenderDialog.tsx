'use client';

import { useRef, useEffect, useState } from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Loader2, Printer, User, Star, Info, AlertCircle, CheckCircle2, Wallet, CreditCard, Banknote } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { SaleItem } from '../pos-content/pos-types';
import type { SystemSettings } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReactToPrint } from 'react-to-print';
import { ReceiptView } from '../receipt/ReceiptView';
import { usePrinter } from '@/lib/use-printer';
import { ReceiptGenerator, saleOpensDrawer } from '@/lib/receipt-generator';
import { useTender } from './use-tender';
import type { TenderDialogProps } from './tender-types';


// Print-only receipt component is imported
// Wrapper for visible receipt view with actions
function ReceiptActionView({
    saleDetails,
    onNewSale,
    onPrint,
    settings
}: {
    saleDetails: any;
    onNewSale: () => void;
    onPrint: () => void;
    settings?: SystemSettings | null;
}) {
    return (
        <div className="flex flex-col h-full bg-gray-50 p-4">
             <div className="flex-1 overflow-auto flex justify-center">
                <div className="bg-white shadow-sm my-4 h-fit">
                    <ReceiptView saleDetails={saleDetails} settings={settings} />
                </div>
            </div>
            <div className="mt-4 flex justify-center gap-4 print:hidden">
                 <Button onClick={onPrint} size="lg" className="w-40">
                    <Printer className="mr-2 h-4 w-4" />
                    Reprint
                </Button>
                <Button onClick={onNewSale} size="lg" className="w-40" variant="secondary">
                    New Sale
                </Button>
            </div>
        </div>
    );
}


export function TenderDialog(props: TenderDialogProps) {
    const { isOpen, onOpenChange, printMode, settings, customer, totalDue, paymentMethods, onTriggerCustomerSelection } = props;
    const { isPrinting, isConnected, connect, print } = usePrinter(printMode, settings?.nativePrinterName);
    const {
        selectedMethod,
        setSelectedMethod,
        amountTendered,
        setAmountTendered,
        referenceInput,
        setReferenceInput,
        payments,
        setPayments,
        isProcessing,
        view,
        setView,
        completedSale,
        pointsToRedeemInput,
        setPointsToRedeemInput,
        pointsInputRef,
        isCashPayment,
        isChargePayment,
        customerPoints,
        pointsToRedeemValue,
        pointsToRedeemCount,
        amountTenderedNum,
        totalAddedPayments,
        balanceRemaining,
        change,
        isReferenceRequired,
        handleAddPayment,
        handleConfirmPayment,
        getQuickAmounts,
        pointsRate,
    } = useTender(props);




    const [isReprintPrint, setIsReprintPrint] = useState(false);

    const receiptRef = useRef<HTMLDivElement>(null);
    const yesButtonRef = useRef<HTMLButtonElement>(null);
    const noButtonRef = useRef<HTMLButtonElement>(null);
    const paymentMethodRef = useRef<HTMLButtonElement>(null);
    const amountTenderedRef = useRef<HTMLInputElement>(null);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const cancelButtonRef = useRef<HTMLButtonElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: receiptRef,
        documentTitle: `Receipt-${new Date().getTime()}`,
        onAfterPrint: () => console.log('Print finished'),
        pageStyle: `
            @page {
                size: ${settings?.paperSize === '80mm' ? '80mm' : '58mm'} auto;
                margin: 0;
            }
            @media print {
                body {
                    -webkit-print-color-adjust: exact;
                    margin: 0;
                    padding: 0;
                }
                .printable-area {
                    box-shadow: none ! from-neutral-500;
                    margin: 0 !important;
                    width: ${settings?.paperSize === '80mm' ? '80mm' : '58mm'} !important;
                }
            }
        `
    });

    const handlePrintReceipt = async (dataToPrint?: any, isReprint = false) => {
         const details = dataToPrint || completedSale;
         if (!details) return;

         if (printMode === 'browser') {
             setIsReprintPrint(isReprint);
             handlePrint();
             return;
         }

         if (!isConnected) {
             const connected = await connect();
             if (!connected) return;
         }

         try {
             const generator = new ReceiptGenerator();
             const bytes = generator.generateReceipt({ ...details, isReprint }, settings);
             await print(bytes);
         } catch (e) {
             console.error("Printing error", e);
         }
    };

    // A cash sale still has to open the drawer when the cashier declines the receipt.
    const kickDrawerOnly = async (details: any) => {
         if (printMode === 'browser' || !saleOpensDrawer(details)) return;

         if (!isConnected) {
             const connected = await connect();
             if (!connected) return;
         }

         try {
             await print(new ReceiptGenerator().generateDrawerKick());
         } catch (e) {
             console.error("Drawer kick error", e);
         }
    };


    const handleCompleteChange = async () => {
        if (!completedSale) return;

        // Transition to Print Prompt after showing change
        setView('print_prompt');
    }

    const handleConfirmPrint = async (shouldPrint: boolean) => {
        if (!completedSale) return;

        if (shouldPrint) {
            await handlePrintReceipt(completedSale);

            // If the setting is enabled, print a second copy
            if (settings?.printTwoReceipts) {
                // Short delay to allow the printer/buffer to breathe
                await new Promise(resolve => setTimeout(resolve, 800));
                // Duplicate copy: the drawer was already kicked by the first receipt.
                await handlePrintReceipt(completedSale, true);
            }

            // Small delay to ensure print command is sent
            setTimeout(() => {
                props.onSuccess(selectedMethod, props.totalDue);
                onOpenChange(false);
            }, 500);
        } else {
            await kickDrawerOnly(completedSale);
            props.onSuccess(selectedMethod, props.totalDue);
            onOpenChange(false);
        }
    };
    
    const handleSmartPrint = () => {
        if (completedSale) {
             handlePrintReceipt(completedSale);
        }
    };

    useEffect(() => {
        if (isOpen) {
            setView('tender');
            // Hook manages initialization already
        }
    }, [isOpen, setView]);

    const handleQuickAmount = (amount: number) => {
        setAmountTendered(amount.toString());
    }

    const handleNewSale = () => {
        onOpenChange(false);
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (view === 'print_prompt') {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                if (document.activeElement === yesButtonRef.current) {
                    noButtonRef.current?.focus();
                } else {
                    yesButtonRef.current?.focus();
                }
            } else if (e.key.toLowerCase() === 'y') {
                e.preventDefault();
                handleConfirmPrint(true);
            } else if (e.key.toLowerCase() === 'n') {
                e.preventDefault();
                handleConfirmPrint(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleConfirmPrint(false);
            }
            return;
        }

        if (view === 'tender') {
            if (e.key === 'ArrowDown' || e.key === 'PageDown') {
                e.preventDefault();
                if (document.activeElement === paymentMethodRef.current) {
                    amountTenderedRef.current?.focus();
                    amountTenderedRef.current?.select();
                } else if (document.activeElement === amountTenderedRef.current) {
                    if (isReferenceRequired) {
                        referenceInputRef.current?.focus();
                    } else {
                        confirmButtonRef.current?.focus();
                    }
                } else if (document.activeElement === referenceInputRef.current) {
                    confirmButtonRef.current?.focus();
                } else if (document.activeElement === confirmButtonRef.current || document.activeElement === cancelButtonRef.current) {
                    paymentMethodRef.current?.focus();
                }
            } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
                e.preventDefault();
                if (document.activeElement === amountTenderedRef.current) {
                    paymentMethodRef.current?.focus();
                } else if (document.activeElement === referenceInputRef.current) {
                    amountTenderedRef.current?.focus();
                    amountTenderedRef.current?.select();
                } else if (document.activeElement === confirmButtonRef.current || document.activeElement === cancelButtonRef.current) {
                    if (isReferenceRequired) {
                        referenceInputRef.current?.focus();
                    } else {
                        amountTenderedRef.current?.focus();
                        amountTenderedRef.current?.select();
                    }
                } else if (document.activeElement === paymentMethodRef.current) {
                    confirmButtonRef.current?.focus();
                }
            } else if (e.key === 'ArrowRight' && document.activeElement === cancelButtonRef.current) {
                e.preventDefault();
                confirmButtonRef.current?.focus();
            } else if (e.key === 'ArrowLeft' && document.activeElement === confirmButtonRef.current) {
                e.preventDefault();
                cancelButtonRef.current?.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onOpenChange(false);
            }
        }
    };


    return (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-[460px] overflow-hidden flex flex-col p-0 gap-0 [&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onKeyDown={handleKeyDown}>
                {view === 'receipt' && completedSale ? (
                    <ReceiptActionView saleDetails={completedSale} onNewSale={handleNewSale} onPrint={handleSmartPrint} settings={settings} />
                ) : view === 'change' && completedSale ? (
                    <div className="flex flex-col h-full animate-in fade-in duration-200">
                        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-6 bg-gradient-to-b from-green-50/60 to-transparent">
                            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center animate-in zoom-in-90 duration-300">
                                <CheckCircle2 className="h-11 w-11 text-green-600" strokeWidth={2.5} />
                            </div>
                            <div className="text-center space-y-1">
                                <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Change Due</p>
                                <div className="text-7xl font-black text-green-600 tabular-nums tracking-tight leading-none">
                                    ₱{completedSale.change.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>
                            <div className="flex items-center gap-6 text-center pt-2">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</p>
                                    <p className="text-lg font-bold text-foreground tabular-nums">₱{completedSale.totalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                                <div className="h-8 w-px bg-border" />
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tendered</p>
                                    <p className="text-lg font-bold text-foreground tabular-nums">₱{Number(completedSale.amountTendered || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-5 border-t bg-background">
                            <Button size="lg" className="w-full h-14 text-lg font-bold shadow-md shadow-primary/20" onClick={handleCompleteChange} autoFocus>
                                Next
                            </Button>
                        </div>
                    </div>
                ) : view === 'print_prompt' && completedSale ? (
                    <div className="flex flex-col h-full animate-in fade-in duration-200">
                        {/* Header */}
                        <div className="px-6 py-4 border-b bg-background">
                            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                <Printer className="h-5 w-5 text-primary" />
                                Print Receipt?
                            </h2>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                Order #{completedSale.orderNumber} saved successfully.
                            </p>
                        </div>

                        {/* Receipt Preview Area */}
                        <div className="flex-1 bg-muted/40 p-4 overflow-y-auto flex justify-center">
                            <div className="bg-white shadow-md h-fit">
                                <ReceiptView saleDetails={completedSale} settings={settings} />
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="p-4 border-t bg-background space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="h-14 text-base font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                                    onClick={() => handleConfirmPrint(false)}
                                    ref={noButtonRef}
                                >
                                    No, Skip
                                </Button>
                                <Button
                                    size="lg"
                                    className="h-14 text-base font-bold shadow-md shadow-primary/20 transition-all active:scale-95"
                                    onClick={() => handleConfirmPrint(true)}
                                    ref={yesButtonRef}
                                    autoFocus
                                >
                                    <Printer className="mr-2 h-5 w-5" />
                                    Yes, Print
                                </Button>
                            </div>
                            <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wider">
                                Arrow keys to navigate • Y for Yes • N for No
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Sticky Header */}
                        <SheetHeader className="px-5 py-4 border-b bg-background text-left space-y-0.5">
                            <SheetTitle className="text-xl font-bold flex items-center gap-2">
                                <Wallet className="h-5 w-5 text-primary" />
                                Tender Payment
                            </SheetTitle>
                            <SheetDescription className="text-muted-foreground text-sm">Finalize the transaction.</SheetDescription>
                        </SheetHeader>

                        {/* Scrollable Body */}
                        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                            {isChargePayment && (!customer || (customer as any).id === 'walk-in') && (
                                <Alert className="bg-orange-50 border-orange-200 text-orange-900 border-2 animate-in fade-in slide-in-from-top-4 duration-500">
                                    <AlertCircle className="h-5 w-5 text-orange-600" />
                                    <AlertTitle className="font-bold text-orange-900">Charge to Account - Customer Required</AlertTitle>
                                    <AlertDescription className="text-orange-700 font-medium">
                                        Please select a customer to proceed with this charge.
                                    </AlertDescription>
                                </Alert>
                            )}

                            {/* Total Due hero */}
                            <div className="rounded-2xl bg-primary/5 border-2 border-primary/10 p-5 text-center">
                                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-1">Total Due</p>
                                <p className="text-5xl font-black text-primary tabular-nums leading-none">₱{totalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                {pointsToRedeemValue > 0 && (
                                    <div className="mt-4 pt-4 border-t border-primary/10 animate-in fade-in duration-300">
                                        <div className="flex justify-between items-center text-foreground font-black text-base">
                                            <span>Net Balance Due</span>
                                            <span className="tabular-nums">₱{balanceRemaining.toFixed(2)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Payment Method Selector */}
                            <div className="space-y-2">
                                <Label htmlFor="paymentMethod" className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                                    <CreditCard className="h-4 w-4" />
                                    Payment Method
                                </Label>
                                <Select
                                    value={selectedMethod}
                                    onValueChange={setSelectedMethod}
                                >
                                    <SelectTrigger className="w-full h-12 text-base font-semibold" ref={paymentMethodRef}>
                                        <SelectValue placeholder="Select Payment Method" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {paymentMethods.map((method) => (
                                            <SelectItem key={method.id} value={method.name}>
                                                {method.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Amount Tendered Section - Always show for Points and Cash */}
                            {(selectedMethod === 'CASH' || selectedMethod === 'POINTS' || (balanceRemaining > 0 && !isChargePayment)) && (
                                <div className="space-y-2">
                                    <Label htmlFor="amountTendered" className="text-sm font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                                        <Banknote className="h-4 w-4" />
                                        {selectedMethod === 'POINTS' ? 'Cash Balance Tendered' : 'Amount Tendered'}
                                    </Label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-muted-foreground pointer-events-none">₱</span>
                                        <Input
                                            id="amountTendered"
                                            ref={amountTenderedRef}
                                            type="text"
                                            inputMode="decimal"
                                            value={amountTendered}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                                    setAmountTendered(value);
                                                }
                                            }}
                                            placeholder="0.00"
                                            className="h-16 text-3xl text-right font-black text-foreground [&:not(:placeholder-shown)]:text-foreground pl-10 pr-4 border-2 focus-visible:ring-primary/30"
                                            style={{ color: 'hsl(var(--foreground))' }}
                                            autoFocus={selectedMethod !== 'POINTS'}
                                            onFocus={(e) => e.target.select()}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    if (!isProcessing) {
                                                        handleConfirmPayment();
                                                    }
                                                }
                                            }}
                                        />
                                    </div>
                                    {/* Quick amounts directly under the amount field */}
                                    {totalDue > 0 && selectedMethod === 'CASH' && (
                                        <div className="grid grid-cols-4 gap-2 pt-1">
                                            {getQuickAmounts(balanceRemaining || totalDue).map(amount => (
                                                <Button key={amount} variant="outline" onClick={() => handleQuickAmount(amount)} className="h-10 font-bold text-sm">₱{amount}</Button>
                                            ))}
                                        </div>
                                    )}
                                    {selectedMethod === 'POINTS' && balanceRemaining > 0 && (
                                        <p className="text-xs text-right text-muted-foreground mt-1 font-medium italic">
                                            Enter the cash amount given by the customer for the remaining balance.
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Reference Input */}
                            {isReferenceRequired && (
                                <div className="space-y-2">
                                    <Label htmlFor="referenceInput" className="text-sm text-red-600 font-bold uppercase tracking-wide">
                                        Reference Number *
                                    </Label>
                                    <Input
                                        id="referenceInput"
                                        ref={referenceInputRef}
                                        type="text"
                                        value={referenceInput}
                                        onChange={(e) => setReferenceInput(e.target.value)}
                                        placeholder="Enter reference # (e.g. Check No., Trans ID)"
                                        className="h-12 text-base"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                if (!isProcessing) handleConfirmPayment();
                                            }
                                        }}
                                    />
                                </div>
                            )}

                            {/* Loyalty Points Redemption (Always available for valid customers with points) */}
                            {customer && (customer as any).id !== 'walk-in' && !(customer as any)?.isExpired && customerPoints > 0 && (
                                <div className="space-y-3 bg-purple-50 p-4 rounded-xl border border-purple-200 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <div className="flex justify-between items-center px-1">
                                        <Label htmlFor="manualPoints" className="text-purple-900 font-bold text-sm flex items-center gap-2">
                                            <Star className="h-4 w-4 text-purple-600 fill-purple-600" />
                                            Redeem Points
                                        </Label>
                                        <span className="text-[10px] font-bold text-purple-600 bg-white px-2 py-0.5 rounded-full border border-purple-100 shadow-sm">
                                            Available: {customerPoints.toLocaleString()} (₱{customerPoints.toFixed(2)})
                                        </span>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Input
                                                id="manualPoints"
                                                ref={pointsInputRef}
                                                type="text"
                                                inputMode="decimal"
                                                value={pointsToRedeemInput}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                        setPointsToRedeemInput(val);
                                                    }
                                                }}
                                                placeholder="0"
                                                className="h-11 text-lg font-bold border-purple-300 focus-visible:ring-purple-500 bg-white text-purple-900 placeholder:text-purple-400 pl-4"
                                            />
                                        </div>
                                        <Button
                                            variant="secondary"
                                            className="bg-purple-600 text-white hover:bg-purple-700 h-11 px-5 font-bold shadow-md shadow-purple-100 transition-all active:scale-95"
                                            onClick={() => {
                                                const maxPossibleValue = Math.min(totalDue, customerPoints);
                                                setPointsToRedeemInput(maxPossibleValue.toFixed(2));
                                            }}
                                        >
                                            Redeem All
                                        </Button>
                                    </div>
                                    <p className="text-[10px] text-purple-600 font-bold px-1 flex items-center gap-1">
                                        <Info className="h-3 w-3" />
                                        1 Point = ₱1.00 (Strict 1:1)
                                    </p>
                                </div>
                            )}

                            {isChargePayment && (
                                <>
                                    {(!customer || (customer as any).id === 'walk-in') ? (
                                        <div className="bg-orange-50 p-6 rounded-xl border-2 border-dashed border-orange-200 flex flex-col items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="p-3 bg-white rounded-full shadow-sm text-orange-600">
                                                <User className="h-6 w-6" />
                                            </div>
                                            <div className="text-center">
                                                <p className="font-bold text-orange-900">Charge to Account requires a Customer</p>
                                                <p className="text-sm text-orange-600/70">Please select a customer to proceed with charging.</p>
                                            </div>
                                            <Button
                                                onClick={onTriggerCustomerSelection}
                                                className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-8 shadow-lg shadow-orange-200"
                                            >
                                                Select Customer
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3 bg-orange-50 p-4 rounded-xl border border-orange-200 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="flex justify-between items-center px-1">
                                                <Label className="text-orange-900 font-bold text-sm flex items-center gap-2">
                                                    <Info className="h-4 w-4 text-orange-600" />
                                                    Account Details
                                                </Label>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="bg-white p-3 rounded-lg border border-orange-100 shadow-sm">
                                                    <p className="text-[10px] text-orange-600 font-bold uppercase">Credit Limit</p>
                                                    <p className="text-lg font-black text-orange-900">₱{(customer as any).creditLimit?.toLocaleString() || '0.00'}</p>
                                                </div>
                                                <div className="bg-white p-3 rounded-lg border border-orange-100 shadow-sm">
                                                    <p className="text-[10px] text-orange-600 font-bold uppercase">Current Balance</p>
                                                    <p className="text-lg font-black text-orange-900">₱{(customer as any).balance?.toLocaleString() || '0.00'}</p>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-orange-600 font-bold px-1 flex items-center gap-1">
                                                <Info className="h-3 w-3" />
                                                This transaction will be added to the customer's account balance.
                                            </p>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Added Payments List */}
                            {payments.length > 0 && (
                                <div className="space-y-2 pt-1">
                                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Added Payments</Label>
                                    <div className="space-y-2">
                                        {payments.map(p => (
                                            <div key={p.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-200 shadow-sm animate-in fade-in slide-in-from-top-1">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-900">{p.method}</span>
                                                    {p.reference && <span className="text-xs text-gray-500 font-medium">Ref: {p.reference}</span>}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="font-black text-gray-900 tabular-nums">₱{p.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    <Button variant="ghost" size="sm" onClick={() => setPayments(payments.filter(x => x.id !== p.id))} className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 px-2">
                                                        Remove
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Add Split Payment */}
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleAddPayment}
                                disabled={amountTenderedNum <= 0 && !isChargePayment}
                                className="w-full border-dashed font-bold text-muted-foreground hover:text-foreground"
                            >
                                + Add Split Payment
                            </Button>
                        </div>

                        {/* Sticky Footer with live Change / Balance */}
                        <div className="border-t bg-background p-4 space-y-3">
                            <div className="flex items-center justify-between px-1">
                                <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                                    {change > 0 ? 'Change' : 'Balance Due'}
                                </span>
                                <span className={`text-2xl font-black tabular-nums ${change > 0 ? 'text-green-600' : 'text-foreground'}`}>
                                    ₱{(change > 0 ? change : balanceRemaining).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div className="grid grid-cols-[1fr_2fr] gap-3">
                                <Button
                                    variant="outline"
                                    onClick={() => onOpenChange(false)}
                                    disabled={isProcessing || (selectedMethod === 'POINTS' && (customer as any)?.isExpired)}
                                    className="h-12 font-bold text-muted-foreground hover:text-foreground"
                                    ref={cancelButtonRef}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleConfirmPayment}
                                    ref={confirmButtonRef}
                                    disabled={
                                        isProcessing ||
                                        (balanceRemaining > 0 && !amountTendered && !isChargePayment) ||
                                        (payments.length === 0 && (selectedMethod === 'CASH' || selectedMethod === 'POINTS') && parseFloat(amountTendered) < balanceRemaining) ||
                                        (pointsToRedeemValue > (Number((customer as any)?.current_points || (customer as any)?.loyaltyPoints || 0) * pointsRate)) ||
                                        (payments.length === 0 && isReferenceRequired && !referenceInput.trim()) ||
                                        (isChargePayment && (!customer || (customer as any).id === 'walk-in'))
                                    }
                                    className="h-12 min-w-[140px] font-bold text-lg shadow-md shadow-primary/20"
                                >
                                    {isProcessing ? (
                                        <>
                                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            Confirm Payment
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>
                    </>
                )}
                {/* Hidden Receipt for Printing - using absolute positioning instead of display:none to ensure it renders for print */}
                <div style={{ position: 'absolute', top: '-9999px', left: '-9999px' }}>
                    {completedSale && <ReceiptView ref={receiptRef} saleDetails={{ ...completedSale, isReprint: isReprintPrint }} settings={settings} />}
                </div>
            </SheetContent>
        </Sheet>
    );
};


