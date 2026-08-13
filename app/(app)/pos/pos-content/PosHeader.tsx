'use client';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  Pencil, X, Percent, Tag, ListOrdered, Plus, FilePenLine, Power,
  RefreshCw, Monitor, Inbox,
} from 'lucide-react';
import type { SuspendedTransaction } from './pos-types';

type Props = {
  selectedItemId: string | null;
  shiftActive: boolean;
  heldTransactions: SuspendedTransaction[];
  currentTerminalName: string;
  currentTime: string;
  enableCustomerDisplay: boolean;
  openOnSecondScreen: () => void;
  handleOpenEditDialog: () => void;
  handleVoidLine: (id: string | null) => void;
  handleOpenDiscountDialog: () => void;
  handleHold: () => void;
  handleOpenSuspended: () => void;
  focusInlineQuantity: (id: string | null) => void;
  handleRequestPriceEdit: () => void;
  handleShutdown: () => void;
  // frontliner / queue
  isFrontliner?: boolean;
  posMode?: 'default' | 'pharmacy';
  queuedOrdersCount?: number;
  setIsQueuePanelOpen?: (v: boolean) => void;
};

export function PosHeader({
  selectedItemId, shiftActive, heldTransactions, currentTerminalName, currentTime,
  enableCustomerDisplay, openOnSecondScreen,
  handleOpenEditDialog, handleVoidLine, handleOpenDiscountDialog, handleHold,
  handleOpenSuspended, focusInlineQuantity, handleRequestPriceEdit, handleShutdown,
  isFrontliner, posMode, queuedOrdersCount = 0, setIsQueuePanelOpen,
}: Props) {

  const headerActions = [
    { icon: Pencil, label: 'Edit Item', fKey: 'F1', action: handleOpenEditDialog, tint: 'text-blue-600' },
    { icon: X, label: 'Line Void', fKey: 'F2', action: () => handleVoidLine(selectedItemId), tint: 'text-rose-600' },
    { icon: Percent, label: 'Discount', fKey: 'F3', action: handleOpenDiscountDialog, tint: 'text-emerald-600' },
    { icon: Tag, label: 'Suspend', fKey: 'F4', action: handleHold, tint: 'text-orange-600' },
    { icon: ListOrdered, label: 'Suspended', fKey: 'F5', action: handleOpenSuspended, tint: 'text-amber-600' },
    { icon: Plus, label: 'Quantity', fKey: 'F6', action: () => focusInlineQuantity(selectedItemId), tint: 'text-indigo-600' },
    { icon: FilePenLine, label: 'Edit Price', fKey: 'F7', action: handleRequestPriceEdit, tint: 'text-purple-600' },
    { icon: Power, label: shiftActive ? 'Endorse/Out' : 'Shutdown', fKey: 'F8', action: handleShutdown, tint: 'text-slate-600' },
  ];

  return (
    <header className="h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center px-4 gap-4 justify-between shrink-0 z-10">
      <div className="flex items-center gap-1 flex-1 px-1 min-w-0">
        {headerActions.map(({ icon: Icon, label, fKey, action, tint, ...rest }) => {
          const highlight = (rest as any).highlight as boolean | undefined;
          return (
            <Button
              key={label}
              variant="ghost"
              size="sm"
              className={`group relative flex h-[3.25rem] w-full max-w-[4.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border px-1 font-normal shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                highlight
                  ? 'border-violet-400/60 bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/30 dark:hover:bg-violet-900/40'
                  : 'border-border/60 bg-background hover:border-primary/30 hover:bg-muted/50'
              }`}
              onClick={action}
            >
              <Icon className={`h-4 w-4 transition-transform group-hover:scale-110 ${tint}`} />
              <span className="w-full truncate text-center text-[10px] leading-none font-medium text-foreground">{label}</span>
              <kbd className="rounded bg-muted px-1 py-px text-[8px] font-mono font-semibold leading-none text-muted-foreground">{fKey}</kbd>
              {label === 'Suspended' && heldTransactions.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white shadow-sm ring-2 ring-background">
                  {heldTransactions.length}
                </span>
              )}
            </Button>
          );
        })}

        {/* Cashier: queue button — only visible in pharmacy mode */}
        {!isFrontliner && posMode === 'pharmacy' && setIsQueuePanelOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="group relative flex h-[3.25rem] w-full max-w-[4.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-violet-400/60 bg-violet-50 px-1 font-normal shadow-sm transition-all hover:-translate-y-0.5 hover:bg-violet-100 dark:bg-violet-950/30 dark:hover:bg-violet-900/40"
            onClick={() => setIsQueuePanelOpen(true)}
          >
            <Inbox className="h-4 w-4 transition-transform group-hover:scale-110 text-violet-600" />
            <span className="w-full truncate text-center text-[10px] leading-none font-medium text-foreground">Queue</span>
            <kbd className="rounded bg-muted px-1 py-px text-[8px] font-mono font-semibold leading-none text-muted-foreground">Ctrl+Q</kbd>
            {queuedOrdersCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-violet-600 text-[9px] font-bold text-white shadow-sm ring-2 ring-background">
                {queuedOrdersCount > 9 ? '9+' : queuedOrdersCount}
              </span>
            )}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 border-l pl-4 ml-2 shrink-0">
        <div className="text-right hidden sm:block">
          <div className="text-xs text-muted-foreground font-medium">{currentTerminalName || 'No Terminal'}</div>
          <div className="text-[10px] text-muted-foreground/70">{currentTime}</div>
        </div>
        <div className={`h-2 w-2 rounded-full ${shiftActive ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'}`} />
        <Button variant="outline" size="icon" onClick={() => window.location.reload()} className="h-9 w-9 rounded-md border border-input bg-transparent hover:bg-accent hover:text-accent-foreground" title="Refresh Page">
          <RefreshCw className="h-4 w-4" />
        </Button>
        {enableCustomerDisplay && (
          <Button variant="outline" size="icon" onClick={openOnSecondScreen} className="h-9 w-9 rounded-md border border-input bg-transparent hover:bg-accent hover:text-accent-foreground" title="Open Customer Display">
            <Monitor className="h-4 w-4" />
          </Button>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
