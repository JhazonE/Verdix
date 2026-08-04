'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Network, Plus, Pencil, Trash2 } from 'lucide-react';
import { type PosTerminal } from './pos-terminals-types';

type Props = {
  terminal: PosTerminal;
  currentTerminalId: string | null;
  warehouses: { id: string; name: string }[];
  isOnline: (lastActive: string | null) => boolean;
  onEdit: (terminal: PosTerminal) => void;
  onConnect: (terminal: PosTerminal) => void;
  onDeleteRequest: (terminal: PosTerminal) => void;
};

export function TerminalCard({ terminal, currentTerminalId, warehouses, isOnline, onEdit, onConnect, onDeleteRequest }: Props) {
  const isCurrent = terminal.id === currentTerminalId;
  const online = isOnline(terminal.lastActive);

  return (
    <Card
      className={`overflow-hidden transition-all hover:shadow-md border-2 cursor-pointer ${isCurrent ? 'border-primary ring-1 ring-primary/20' : 'border-border'}`}
      onClick={() => onEdit(terminal)}
    >
      <CardHeader className="pb-3 space-y-0">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
          <div onClick={e => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(terminal)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDeleteRequest(terminal)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-2">
          <CardTitle className="text-xl flex items-center gap-2">
            {terminal.terminalDescription || 'Unnamed Terminal'}
            {isCurrent && (
              <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/15 border-none font-bold text-[10px]">
                CURRENT
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5 mt-1 font-mono text-xs">
            <Network className="h-3 w-3" />
            {terminal.ipAddress || 'No IP Address'}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {[
              { label: 'Serial Number', value: terminal.serialNumber },
              { label: 'MIN',           value: terminal.min },
              { label: 'Permit No',     value: terminal.permitNo },
              { label: 'Accreditation No', value: terminal.accreditationNo },
              { label: 'PTU Date Issued', value: terminal.permitDateIssued ? String(terminal.permitDateIssued).split('T')[0] : null },
              { label: 'Receipt',       value: terminal.printOfficialReceipt === 'Yes' ? 'Official' : 'Registry' },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col">
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">{label}</span>
                <span className="font-medium truncate">{value || '—'}</span>
              </div>
            ))}
          </div>

          <div className="pt-2 flex flex-col border-t mt-2">
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight mb-1 flex items-center gap-1">
              <Plus className="h-2 w-2" /> Inventory Location
            </span>
            <span className="text-sm font-medium">
              {warehouses.find(w => w.id === terminal.inventoryLocation)?.name || terminal.inventoryLocation || 'Main Store'}
            </span>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          {!isCurrent ? (
            <Button
              className="w-full h-9 bg-primary/5 text-primary hover:bg-primary hover:text-primary-foreground border-primary/20"
              variant="outline"
              onClick={e => { e.stopPropagation(); onConnect(terminal); }}
            >
              Connect to this Machine
            </Button>
          ) : (
            <Button className="w-full h-9 pointer-events-none" variant="secondary">
              Already Connected
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
