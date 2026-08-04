'use client';

import { Pencil, Trash2, Check, MoreHorizontal } from 'lucide-react';

import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PriceLevel } from '@/lib/types';

export function PriceLevelRow({
  level,
  onDelete,
  onEdit,
}: {
  level: PriceLevel;
  onDelete: (id: string) => Promise<void>;
  onEdit: (level: PriceLevel) => void;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {level.name}
          {level.isDefault && (
            <Check className="h-4 w-4 text-green-500" />
          )}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{level.description}</TableCell>
      <TableCell className="text-center">
        {level.adjustmentType === 'fixed' ? `₱${level.percentageAdjustment}` : `${level.percentageAdjustment}%`}
        <br /> <span className="text-xs text-muted-foreground">on {level.calculationBase === 'cost' ? 'Cost' : 'Retail'}</span>
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted">
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[160px] z-[100]">
            <DropdownMenuItem onClick={() => onEdit(level)}>
              <Pencil className="mr-2 h-4 w-4" />
              <span>Edit</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(level.id)}
              disabled={level.isDefault}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
