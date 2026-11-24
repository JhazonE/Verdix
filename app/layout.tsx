import React from 'react';
import './globals.css';
import ClientLayout from '../components/client-layout';
import { COLOR_THEME_BOOT_SCRIPT } from '../lib/color-themes';

export const metadata = {
  title: 'VENDIX POS',
  description: 'Point of Sales + Inventory Management',
  icons: {
    icon: [
      { url: '/verdix_logo.png' }
    ],
    apple: '/verdix_logo.png',
  },
};

// import { Inter } from 'next/font/google';
// const inter = Inter({ subsets: ['latin'] });
const inter = { className: 'font-sans' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Paint the cached store colour theme before hydration (no blue flash). */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
