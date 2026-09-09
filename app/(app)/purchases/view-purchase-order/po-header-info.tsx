'use client';

import { format } from 'date-fns';
import { Building2, MapPin, Calendar, CreditCard } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { type PurchaseOrder } from '@/lib/types';
import { type BusinessProfile } from '@/lib/types';

interface PoHeaderInfoProps {
  order: PurchaseOrder;
  profile: BusinessProfile | null | undefined;
}

export function PoHeaderInfo({ order, profile }: PoHeaderInfoProps) {
  return (
    <>
      {/* Top Branding Section */}
      <div className="flex justify-between items-start">
        <div className="flex gap-4">
          <div className="h-16 w-16 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
            <Building2 className="size-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-950">
              {profile?.businessName || 'verdix Inc.'}
            </h2>
            <div className="text-zinc-700 space-y-0.5 text-xs">
              <p>{profile?.address || '123 Business Avenue, Tech District'}</p>
              <p>
                {profile?.contactNumber || '+63 900 000 0000'} •{' '}
                {profile?.email || 'contact@verdix.app'}
              </p>
            </div>
          </div>
        </div>
        <div className="text-right space-y-2">
          <h1 className="text-4xl font-black text-zinc-950 tracking-tighter/5">PURCHASE ORDER</h1>
          <p className="text-lg font-bold text-zinc-700">
            #{order.referenceNumber || order.id.substring(0, 8).toUpperCase()}
          </p>
        </div>
      </div>

      <Separator className="bg-zinc-300" />

      {/* Info Grid */}
      <div className="grid grid-cols-3 gap-12">
        {/* Supplier */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900 flex items-center gap-2">
            <Building2 className="size-3" /> Supplier
          </h3>
          <div className="space-y-1 border-l-2 pl-3 border-primary/40">
            <p className="font-bold text-base text-zinc-900">{order.supplierName}</p>
            <p className="text-zinc-700">Supplier ID: {order.supplierId.substring(0, 8)}</p>
            <p className="text-zinc-700 font-medium">Manila, Philippines</p>
          </div>
        </div>

        {/* Ship To */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900 flex items-center gap-2">
            <MapPin className="size-3" /> Ship To
          </h3>
          <div className="space-y-1 border-l-2 pl-3 border-zinc-400">
            <p className="font-bold text-base text-zinc-900">
              {order.orderedBy || 'Main Warehouse'}
            </p>
            <p className="text-zinc-700">Purok sto. Nino, Bunao</p>
            <p className="text-zinc-700">Quezon City</p>
          </div>
        </div>

        {/* Details */}
        <div className="bg-zinc-100 p-4 rounded-lg space-y-3 border border-zinc-300">
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-700 font-bold flex items-center gap-1.5">
              <Calendar className="size-3" /> Issue Date
            </span>
            <span className="font-bold text-zinc-900">
              {format(new Date(order.date), 'MMM dd, yyyy')}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-700 font-bold flex items-center gap-1.5">
              <Calendar className="size-3" /> Delivery Date
            </span>
            <span className="font-bold text-zinc-900">
              {order.deliveryDate
                ? format(new Date(order.deliveryDate), 'MMM dd, yyyy')
                : '-'}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-zinc-700 font-bold flex items-center gap-1.5">
              <CreditCard className="size-3" /> Terms
            </span>
            <span className="font-bold text-zinc-900">{order.paymentMethod || 'Net 30'}</span>
          </div>
        </div>
      </div>
    </>
  );
}
