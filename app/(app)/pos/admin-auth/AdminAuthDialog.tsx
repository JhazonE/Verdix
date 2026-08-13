'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, XCircle } from 'lucide-react';
import { useAdminAuth } from './use-admin-auth';
import type { AdminAuthDialogProps } from './admin-auth-types';

export function AdminAuthDialog({
  isOpen, onOpenChange, onSuccess, requiredCredentials,
  title, description, preventCloseAutoFocus,
}: AdminAuthDialogProps) {
  const { username, setUsername, password, setPassword, isProcessing, error, handleAuthenticate } =
    useAdminAuth({ isOpen, onSuccess, onOpenChange, requiredCredentials });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md z-[120]"
        overlayClassName="z-[120]"
        onCloseAutoFocus={preventCloseAutoFocus ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title || 'Admin Authentication Required'}
            {error && (
              <Badge variant="destructive" className="px-2 py-0.5 animate-in zoom-in-95 duration-300">
                <XCircle className="w-3 h-3 mr-1" />
                Invalid
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {description || 'Enter admin credentials to authorize this action.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          {error && (
            <div className="p-2 text-sm text-destructive bg-destructive/10 rounded-md">{error}</div>
          )}
          <div className="space-y-2">
            <Label htmlFor="admin-username">Username</Label>
            <Input
              id="admin-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Admin username"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAuthenticate()}
              placeholder="Admin password"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleAuthenticate} disabled={isProcessing || !password}>
            {isProcessing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Authenticating...</>
            ) : 'Authenticate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
