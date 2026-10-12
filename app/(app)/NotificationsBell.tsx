'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell } from 'lucide-react';
import { getLowStockAlerts } from './products/actions';
import { useLiveRefresh } from '@/hooks/use-live-refresh';

type AppUser = {
  email: string;
  permissions?: string[];
  userType?: string;
  roleId?: string;
  uid?: string;
};

type Notification = {
  id: string;
  title: string;
  message: string;
  type: 'warning' | 'info';
  link: string;
};

export function NotificationsBell({ user }: { user: AppUser | null }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const checkNotifications = useCallback(async () => {
    try {
      const settingsRes = await fetch('/api/pos-settings');
      if (!settingsRes.ok) return;
      const settingsResult = await settingsRes.json();
      if (!settingsResult.success || !settingsResult.data.enablePushNotifications) {
        setNotifications([]);
        return;
      }

      const lowStock = await getLowStockAlerts();
      const lowStockNotifications: Notification[] = lowStock.map((p: any) => ({
        id: `low-stock-${p.id}`,
        title: 'Low Stock Alert',
        message: `${p.name} is below reorder point (${p.stock}/${p.reorderPoint})`,
        type: 'warning',
        link: '/products?filter=low-stock',
      }));

      let approvalNotifications: Notification[] = [];
      if (user) {
        const approvalsRes = await fetch('/api/approvals/queue?status=ALL');
        if (!approvalsRes.ok) return;
        const approvalsData = await approvalsRes.json();

        if (approvalsData.success) {
          const items = approvalsData.data;

          const canAction = (item: any) => {
            if (item.status !== 'Pending') return false;
            const isAdmin = user.userType === 'Admin' || user.userType === 'Super Admin' || user.email === 'admin@example.com';
            if (isAdmin) return true;
            const byId = user.roleId && String(user.roleId) === String(item.currentStepRoleId);
            const byName = user.userType && String(user.userType) === String(item.currentStepRole);
            return !!(byId || byName);
          };

          const approverNotes: Notification[] = items.filter(canAction).map((item: any) => ({
            id: `approval-pending-${item.id}`,
            title: 'Pending Approval',
            message: `${item.transaction_type.replace(/_/g, ' ')} requested by ${item.requester_name}`,
            type: 'info',
            link: '/approvals',
          }));

          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const requesterNotes: Notification[] = items
            .filter((item: any) => item.created_by === user.uid && item.status !== 'Pending' && new Date(item.updated_at) > oneDayAgo)
            .map((item: any) => ({
              id: `approval-status-${item.id}`,
              title: `Request ${item.status}`,
              message: `Your ${item.transaction_type.replace(/_/g, ' ')} request has been ${item.status.toLowerCase()}`,
              type: item.status === 'Approved' ? 'info' : 'warning',
              link: '/approvals',
            }));

          approvalNotifications = [...approverNotes, ...requesterNotes];
        }
      }

      setNotifications([...lowStockNotifications, ...approvalNotifications]);
    } catch (error) {
      console.error('Failed to fetch notifications', error);
    }
  }, [user]);

  useEffect(() => {
    checkNotifications();
    const interval = setInterval(checkNotifications, 30000);
    return () => clearInterval(interval);
  }, [checkNotifications]);

  useLiveRefresh(checkNotifications);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full relative">
          <Bell className="h-5 w-5" />
          {notifications.length > 0 && (
            <span className="absolute top-1 right-1 h-3 w-3 rounded-full bg-red-600 border-2 border-background animate-pulse" />
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4 font-medium border-b">Notifications</div>
        <div className="max-h-[300px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No new notifications</div>
          ) : (
            <div className="grid">
              {notifications.map(notification => (
                <div
                  key={notification.id}
                  className="p-4 hover:bg-muted/50 cursor-pointer border-b last:border-0 transition-colors"
                  onClick={() => { setIsOpen(false); router.push(notification.link); }}
                >
                  <div className="flex gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-orange-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none">{notification.title}</p>
                      <p className="text-sm text-muted-foreground mt-1 text-xs">{notification.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
