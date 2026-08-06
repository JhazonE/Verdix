'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/api-config';
import type { ProductSalesData } from './by-product-types';

type QueryParams = {
  searchTerm: string;
  dateRange: DateRange | undefined;
  terminal: string;
  categoryFilter: string;
  brandFilter: string;
  cashierFilter: string;
  referenceFilter: string;
  currentPage: number;
  limit: number;
};

export function useByProductQuery({
  searchTerm, dateRange, terminal,
  categoryFilter, brandFilter, cashierFilter, referenceFilter,
  currentPage, limit,
}: QueryParams) {
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const { data: attributesData } = useQuery({
    queryKey: ['salesByProductAttributes'],
    queryFn: async () => {
      const res = await fetch(getApiUrl('/sales/by-product/attributes'));
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: usersData } = useQuery({
    queryKey: ['cashiersForByProduct'],
    queryFn: async () => {
      const res = await fetch(getApiUrl('/users'));
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: productData, isLoading } = useQuery({
    queryKey: [
      'productSales',
      searchTerm,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString(),
      terminal,
      currentPage,
      limit,
      categoryFilter,
      brandFilter,
      cashierFilter,
      referenceFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.from) params.append('startDate', format(dateRange.from, 'yyyy-MM-dd'));
      if (dateRange?.to) params.append('endDate', format(dateRange.to, 'yyyy-MM-dd'));
      if (terminal && terminal !== 'all') params.append('terminalId', terminal);
      if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter);
      if (brandFilter && brandFilter !== 'all') params.append('brand', brandFilter);
      if (cashierFilter && cashierFilter !== 'all') params.append('cashier', cashierFilter);
      if (referenceFilter) params.append('reference', referenceFilter);
      params.append('page', currentPage.toString());
      params.append('limit', limit.toString());
      if (searchTerm) params.append('search', searchTerm);
      const res = await fetch(getApiUrl(`/sales/by-product?${params.toString()}`));
      return res.json();
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (productData?.success) {
      if (productData.pagination.totalPages !== totalPages)
        setTotalPages(productData.pagination.totalPages);
      if (productData.pagination.totalItems !== totalItems)
        setTotalItems(productData.pagination.totalItems);
    }
  }, [productData]);

  const productSales: ProductSalesData[] = productData?.success ? productData.data : [];
  const categories: string[] = attributesData?.success ? attributesData.categories : [];
  const brands: string[] = attributesData?.success ? attributesData.brands : [];
  const cashiers: { uid: string; displayName: string }[] = Array.isArray(usersData)
    ? usersData.map((u: any) => ({ uid: u.uid, displayName: u.displayName || u.email }))
    : [];

  return { productSales, isLoading, totalPages, totalItems, categories, brands, cashiers };
}
