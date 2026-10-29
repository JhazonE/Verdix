'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Pencil, Trash2, Check } from 'lucide-react';
import { TaxRate } from '@/lib/types';

type Props = {
  taxRates: TaxRate[];
  isLoading: boolean;
  onEdit: (rate: TaxRate) => void;
  onDeleteRequest: (rate: TaxRate) => void;
};

export function TaxRatesTable({ taxRates, isLoading, onEdit, onDeleteRequest }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax Rates List</CardTitle>
        <CardDescription>View and manage all registered tax rates</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tax Name</TableHead>
                  <TableHead>Rate (%)</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxRates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No tax rates found. Click &quot;Add Tax Rate&quot; to create one.
                    </TableCell>
                  </TableRow>
                ) : taxRates.map(rate => (
                  <TableRow
                    key={rate.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onEdit(rate)}
                  >
                    <TableCell className="font-medium">{rate.name}</TableCell>
                    <TableCell>{rate.rate}%</TableCell>
                    <TableCell>{rate.description || '-'}</TableCell>
                    <TableCell>
                      {rate.isDefault
                        ? <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" /> Default</Badge>
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          onClick={e => { e.stopPropagation(); onEdit(rate); }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                          onClick={e => { e.stopPropagation(); onDeleteRequest(rate); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
