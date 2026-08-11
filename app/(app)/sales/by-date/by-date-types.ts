export type SalesData = {
  date: string;
  transactionCount: number;
  startOR: string;
  endOR: string;
  // BIR OR-series counterpart of startOR/endOR (Task 9, mirroring Tasks 7/8's
  // minSaleOrId/maxSaleOrId). Goods (si_number, aliased above as startOR/endOR)
  // and services (bir_or_number) are independent BIR numbering sequences, so
  // their ranges are kept in separate fields rather than merged.
  startBirOr: string;
  endBirOr: string;
  totalRevenue: number;
  totalDiscount: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  nonVatSales: number;
  cost: number;
  profit: number;
};
