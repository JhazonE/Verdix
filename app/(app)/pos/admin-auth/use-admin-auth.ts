'use client';

import { useState, useEffect } from 'react';
import { getApiUrl } from '@/lib/api-config';
import type { AuthApprover } from './admin-auth-types';

type Options = {
  isOpen: boolean;
  onSuccess: (approver: AuthApprover) => void;
  onOpenChange: (open: boolean) => void;
  requiredCredentials?: { username?: string | null; password?: string | null } | null;
};

export function useAdminAuth({ isOpen, onSuccess, onOpenChange, requiredCredentials }: Options) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUsername('');
      setPassword('');
      setIsProcessing(false);
      setError(null);
    }
  }, [isOpen]);

  const handleAuthenticate = async () => {
    setIsProcessing(true);
    setError(null);

    if (requiredCredentials) {
      const validUser = !requiredCredentials.username || requiredCredentials.username === username;
      const validPass = !requiredCredentials.password || requiredCredentials.password === password;
      if (validUser && validPass) {
        // Only a CONFIGURED username identifies the approver; with none set,
        // any username passes, so the typed one is not recorded.
        const approver: AuthApprover = {
          userId: null,
          name: requiredCredentials.username || null,
        };
        setTimeout(() => {
          onSuccess(approver);
          onOpenChange(false);
          setIsProcessing(false);
        }, 500);
      } else {
        setError('Invalid credentials');
        setPassword('');
        setIsProcessing(false);
      }
      return;
    }

    try {
      const response = await fetch(getApiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();

      if (response.ok) {
        const userType = (result.userType || '').toUpperCase();
        const permissions: string[] = result.permissions || [];
        const hasPermission =
          userType === 'ADMIN' || userType === 'SUPER_ADMIN' || userType === 'MANAGER' ||
          permissions.includes('manage_settings') || permissions.includes('manage_users') ||
          permissions.includes('edit_price') || permissions.includes('super_admin');

        if (hasPermission) {
          onSuccess({
            userId: result.uid ?? null,
            name: result.displayName || username || null,
          });
          onOpenChange(false);
        } else {
          setError('You do not have permission to perform this action.');
          setPassword('');
        }
      } else {
        setError(result.error || 'Invalid credentials');
        setPassword('');
      }
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return { username, setUsername, password, setPassword, isProcessing, error, handleAuthenticate };
}
