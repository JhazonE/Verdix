import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

export function Pagination({
  total, page, pageSize, onPageChange, onPageSizeChange, pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  pageSizeOptions?: number[];
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 4) pages.push('ellipsis');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 3) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 select-none">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{total === 0 ? 'No results' : `${from}–${to} of ${total}`}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs hidden sm:inline">Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {pageSizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {getPageNumbers().map((p, idx) =>
          p === 'ellipsis' ? (
            <span key={`e-${idx}`} className="h-8 w-8 flex items-center justify-center text-muted-foreground text-sm">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={`inline-flex items-center justify-center h-8 w-8 rounded-md border text-sm transition-colors ${
                p === page
                  ? 'border-primary bg-primary text-primary-foreground font-semibold'
                  : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
