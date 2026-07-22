'use client';

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ExpiringBatch {
  batchId: string;
  productId: string;
  productName: string;
  sku: string | null;
  quantityRemaining: number;
  expirationDate: string;
  daysUntilExpiry: number;
  isExpired: boolean;
}

export default function ExpiringSoonPage() {
  const [items, setItems] = useState<ExpiringBatch[]>([]);
  const [days, setDays] = useState('30');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/expiring-soon?days=${days}`)
      .then(r => r.json())
      .then(d => setItems(d.success ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [days]);

  const expired = items.filter(i => i.isExpired);
  const upcoming = items.filter(i => !i.isExpired);

  const renderRows = (rows: ExpiringBatch[]) =>
    rows.map(item => (
      <TableRow key={item.batchId}>
        <TableCell className="font-medium">{item.productName}</TableCell>
        <TableCell className="text-xs font-mono text-muted-foreground">{item.sku || '—'}</TableCell>
        <TableCell className="tabular-nums">{item.quantityRemaining}</TableCell>
        <TableCell className="tabular-nums">{item.expirationDate}</TableCell>
        <TableCell>
          <Badge variant={item.isExpired ? 'destructive' : 'secondary'}>
            {item.isExpired
              ? `Expired ${Math.abs(item.daysUntilExpiry)}d ago`
              : `${item.daysUntilExpiry}d left`}
          </Badge>
        </TableCell>
      </TableRow>
    ));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expiring Soon</h1>
          <p className="text-sm text-muted-foreground">Stock on hand approaching its expiration date.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Next 7 days</SelectItem>
            <SelectItem value="30">Next 30 days</SelectItem>
            <SelectItem value="90">Next 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No stock expiring in this window.
          </CardContent>
        </Card>
      ) : (
        <>
          {expired.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader><CardTitle className="text-destructive text-base">Already Expired ({expired.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead><TableHead>SKU</TableHead>
                      <TableHead>Qty</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(expired)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {upcoming.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Expiring Soon ({upcoming.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead><TableHead>SKU</TableHead>
                      <TableHead>Qty</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(upcoming)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
