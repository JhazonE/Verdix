'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MonitorSmartphone, ShieldX, Info } from 'lucide-react';

type Props = {
  /** 'unresolved' = terminals exist but this machine is unidentified.
   *  'no-terminals' = nothing registered yet; nothing to choose from. */
  issue: 'unresolved' | 'no-terminals' | null;
  terminals: any[];
  clientIp?: string | null;
  onSelect: (terminalId: string) => void;
};

/**
 * Blocks the POS until this machine's terminal is known.
 *
 * Deliberately has no dismiss path: trading under a guessed identity files
 * sales, shifts and Z-readings against another till, and a Z-reading is a BIR
 * record that cannot be safely corrected afterwards. One prompt is cheaper.
 */
export function TerminalIdentityPrompt({ issue, terminals, clientIp, onSelect }: Props) {
  const [choice, setChoice] = useState<string>('');

  if (!issue) return null;

  const noTerminals = issue === 'no-terminals';

  return (
    <Dialog open>
      {/* DialogContent always renders a close button and has no prop to
          suppress it, so [&>button]:hidden removes the dismiss path. */}
      <DialogContent
        className="sm:max-w-sm p-0 overflow-hidden gap-0 [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="bg-gradient-to-br from-amber-600 to-amber-800 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              {noTerminals ? <ShieldX className="h-5 w-5" /> : <MonitorSmartphone className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-xs font-medium text-amber-200">Terminal Setup</p>
              <p className="text-base font-bold leading-tight">
                {noTerminals ? 'No Terminal Registered' : 'Which Terminal Is This?'}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-sm font-semibold">
              {noTerminals ? 'Registration required' : 'Identify this machine'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
              {noTerminals
                ? 'No active POS terminals are registered yet. Add this machine in Settings › POS Terminals before taking sales.'
                : 'This machine could not be matched to a registered terminal automatically. Select which terminal it is — this is remembered on this machine.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
            <Info className="h-4 w-4 text-amber-600 shrink-0 mt-px" />
            <p className="text-[11px] text-amber-700/90 dark:text-amber-400 leading-relaxed">
              Sales, shifts and Z-readings are filed against the terminal chosen
              here, so the POS will not continue until it is correct.
              {clientIp ? <> Detected address: <span className="font-mono">{clientIp}</span>.</> : null}
            </p>
          </div>

          {!noTerminals && (
            <>
              <Select value={choice} onValueChange={setChoice}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select this terminal" />
                </SelectTrigger>
                <SelectContent>
                  {terminals.map((t: any) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.terminalDescription || t.name || t.id}
                      {t.ipAddress ? ` — ${t.ipAddress}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                disabled={!choice}
                onClick={() => onSelect(choice)}
              >
                Use this terminal
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
