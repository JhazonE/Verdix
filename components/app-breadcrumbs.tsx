'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Fragment } from 'react';

// POS Reports live under /sales/* (linked from the Reports page). The generic
// logic strips "sales", which would leave them with no "Reports" parent.
const POS_REPORT_LABELS: Record<string, string> = {
  '': 'POS Sales Transaction',
  'details': 'POS Sales Detail',
  'by-product': 'Sales by Product/Service',
  'by-date': 'Sales by Date',
  'returns': 'Merchandise Credits',
  'voids': 'Post Void',
  'cash-transfer': 'POS Cash Transfer',
  'z-reading': 'POS Z-Reading',
  'x-reading': 'POS X-Reading',
  'overall-reading': 'POS Overall Reading',
  'analysis': 'Sales Analysis',
};

export function AppBreadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  const posReportLabel = parts[0] === 'sales' && parts.length <= 2 ? POS_REPORT_LABELS[parts[1] ?? ''] : undefined;
  if (posReportLabel) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/reports">Reports</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{posReportLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }
  const segments = pathname.split('/').filter(Boolean).filter(segment => segment !== 'sales' && segment !== 'purchases');

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="/">Home</BreadcrumbLink>
        </BreadcrumbItem>
        {segments.map((segment, index) => {
          const hrefArr = pathname.split('/').filter(Boolean);
          const segmentIndexInPath = hrefArr.lastIndexOf(segment);
          const href = `/${hrefArr.slice(0, segmentIndexInPath + 1).join('/')}`;
          const isLast = index === segments.length - 1;
          const isPurchases = pathname.includes('/purchases/');
          
          // Custom label mappings
          const labelMap: Record<string, string> = {
            'returns': 'Merchandise Credits',
            'voids': 'Post Void',
            'by-product': isPurchases ? 'Purchases by Product' : 'Sales by Product',
            'by-supplier': 'Purchases by Supplier',
            'profit-margin': 'Profit Margin',
            'by-customer': 'Sales by Customer',
            'summary': isPurchases ? 'Purchases Summary' : 'Sales Summary',
          };
          
          const defaultLabel = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
          const label = labelMap[segment] || defaultLabel;

          return (
            <Fragment key={href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
