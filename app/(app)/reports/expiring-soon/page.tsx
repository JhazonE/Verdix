'use client';

import { useEffect, useState } from 'react';

import { format } from 'date-fns';
import { FileSpreadsheet } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ReportSearchInput } from '@/components/reports/ReportSearchInput';
import { useToast } from '@/hooks/use-toast';
import { exportReportExcel } from '@/lib/report-print';

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
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reports/expiring-soon?days=${days}`)
      .then(r => r.json())
      .then(d => setItems(d.success ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [days]);

  const filteredItems = items.filter((item) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase();
    return (
      item.productName?.toLowerCase().includes(search) ||
      item.sku?.toLowerCase().includes(search)
    );
  });
  const filteredExpired = filteredItems.filter((i) => i.isExpired);
  const filteredUpcoming = filteredItems.filter((i) => !i.isExpired);

  const exportToExcel = () => {
    const fileName = `Expiring_Soon_${format(new Date(), 'yyyyMMdd')}.xls`;
    const combined = [
      ...filteredExpired.map((i) => ({ ...i, statusLabel: `Expired ${Math.abs(i.daysUntilExpiry)}d ago` })),
      ...filteredUpcoming.map((i) => ({ ...i, statusLabel: `${i.daysUntilExpiry}d left` })),
    ];
    const ok = exportReportExcel<typeof combined[number]>({
      title: 'Expiring Soon Report',
      subtitle: `Generated ${format(new Date(), 'yyyy-MM-dd')}`,
      columns: [
        { header: 'Product', cell: (r) => r.productName },
        { header: 'SKU', cell: (r) => r.sku || '—' },
        { header: 'Qty', align: 'right', cell: (r) => r.quantityRemaining },
        { header: 'Expires', cell: (r) => r.expirationDate },
        { header: 'Status', cell: (r) => r.statusLabel },
      ],
      rows: combined,
      fileName,
    });
    if (!ok) {
      toast({ title: 'No Data', description: 'No records to export.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Excel Exported', description: `Report saved as ${fileName}` });
  };

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
        <div className="flex items-center gap-2">
          <ReportSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search product, SKU..."
          />
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Next 7 days</SelectItem>
              <SelectItem value="30">Next 30 days</SelectItem>
              <SelectItem value="90">Next 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={exportToExcel}
            variant="outline"
            className="gap-2 border-emerald-700 text-emerald-700 hover:bg-emerald-50"
            disabled={filteredItems.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export to Excel
          </Button>
        </div>
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
          {filteredExpired.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader><CardTitle className="text-destructive text-base">Already Expired ({filteredExpired.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead><TableHead>SKU</TableHead>
                      <TableHead>Qty</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(filteredExpired)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {filteredUpcoming.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Expiring Soon ({filteredUpcoming.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead><TableHead>SKU</TableHead>
                      <TableHead>Qty</TableHead><TableHead>Expires</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(filteredUpcoming)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
