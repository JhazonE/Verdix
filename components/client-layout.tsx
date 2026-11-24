'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const Toaster = dynamic(
  () => import('@/components/ui/toaster').then((mod) => ({ default: mod.Toaster })),
  { ssr: false }
);

import { ThemeProvider } from '@/components/theme-provider';
import { LicenseGate } from '@/components/license-gate';
import { ColorThemeSync } from '@/components/color-theme-sync';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ColorThemeSync />
      <LicenseGate>{children}</LicenseGate>
      <Toaster />
    </ThemeProvider>
  );
}
