import { formatCurrency, toSafeNumber } from '@/lib/utils';

export function PrintLayout({
  count,
  printItems,
  isCompleted,
  totalVariance,
  totalVarianceAmount,
  page,
  totalPages,
}: {
  count: any;
  printItems: any[];
  isCompleted: boolean;
  totalVariance: number;
  totalVarianceAmount: number;
  page: number;
  totalPages: number;
}) {
  return (
    <div className="hidden print:block printable-area p-8 bg-white text-black font-sans">
      <div className="mb-8 border-b-2 border-black pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">STOCK COUNT REPORT</h1>
          <h2 className="text-xl font-semibold text-gray-700">{count.name}</h2>
          {count.notes && <p className="text-gray-500 mt-2 italic">{count.notes}</p>}
        </div>
        <div className="text-right text-sm text-gray-600">
          <p>
            <strong>Status:</strong> {count.status.replace('_', ' ').toUpperCase()}
          </p>
          <p>
            <strong>Created Date:</strong>{' '}
            {new Date(count.created_at).toLocaleDateString()}
          </p>
          {isCompleted && count.completed_at && (
            <p>
              <strong>Completed Date:</strong>{' '}
              {new Date(count.completed_at).toLocaleDateString()}
            </p>
          )}
          <p>
            <strong>Created By:</strong> {count.created_by}
          </p>
        </div>
      </div>

      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="py-3 px-2 font-bold uppercase tracking-wider">Product Name</th>
            <th className="py-3 px-2 font-bold uppercase tracking-wider">Barcode</th>
            <th className="py-3 px-2 font-bold uppercase tracking-wider text-right">
              Expected
            </th>
            <th className="py-3 px-2 font-bold uppercase tracking-wider text-right">
              Actual Count
            </th>
            <th className="py-3 px-2 font-bold uppercase tracking-wider text-right">
              Cost Amount
            </th>
            <th className="py-3 px-2 font-bold uppercase tracking-wider text-right">
              Retail Amount
            </th>
            <th className="py-3 px-2 font-bold uppercase tracking-wider text-right">
              Variance
            </th>
            <th className="py-3 px-2 font-bold uppercase tracking-wider text-right">
              Variance Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {printItems.map((item, index) => {
            const variance =
              item.counted_quantity !== null
                ? item.counted_quantity - item.snapshot_quantity
                : 0;
            const actualQty = toSafeNumber(item.counted_quantity);
            const costAmount = actualQty * toSafeNumber(item.product_cost);
            const retailAmount = actualQty * toSafeNumber(item.product_retail);
            return (
              <tr
                key={`print-${item.id}`}
                className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}
              >
                <td className="py-3 px-2 border-b border-gray-200">{item.product_name}</td>
                <td className="py-3 px-2 border-b border-gray-200 text-gray-600">
                  {item.product_barcode || '-'}
                </td>
                <td className="py-3 px-2 border-b border-gray-200 text-right">
                  {item.snapshot_quantity}
                </td>
                <td className="py-3 px-2 border-b border-gray-200 text-right font-semibold">
                  {item.counted_quantity !== null ? item.counted_quantity : '______'}
                </td>
                <td className="py-3 px-2 border-b border-gray-200 text-right">
                  {formatCurrency(costAmount)}
                </td>
                <td className="py-3 px-2 border-b border-gray-200 text-right">
                  {formatCurrency(retailAmount)}
                </td>
                <td className="py-3 px-2 border-b border-gray-200 text-right">
                  {item.counted_quantity === null
                    ? '-'
                    : variance >= 0
                    ? `+${variance}`
                    : variance}
                </td>
                <td className="py-3 px-2 border-b border-gray-200 text-right">
                  {item.counted_quantity === null
                    ? '-'
                    : formatCurrency(variance * toSafeNumber(item.product_cost))}
                </td>
              </tr>
            );
          })}
        </tbody>
        {printItems.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-black font-bold">
              <td className="py-3 px-2 text-right" colSpan={6}>
                Totals (this page)
              </td>
              <td className="py-3 px-2 text-right">
                {totalVariance > 0 ? `+${totalVariance}` : totalVariance}
              </td>
              <td className="py-3 px-2 text-right">
                {formatCurrency(totalVarianceAmount)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      <div className="mt-12 pt-8 border-t border-gray-300 flex justify-between text-sm text-gray-500">
        <p>Report generated on: {new Date().toLocaleString()}</p>
        <p>Page {page} of {totalPages}</p>
      </div>
    </div>
  );
}
