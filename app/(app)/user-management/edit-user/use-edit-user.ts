'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { logActivity } from '@/lib/client-activity-logger';
import { User, editUserSchema, EditUserFormValues } from './edit-user-types';

type Props = {
  user: User;
  onUserUpdated: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function useEditUser({ user, onUserUpdated, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [userTypes, setUserTypes] = useState<any[]>([]);
  const [isUserTypeDialogOpen, setIsUserTypeDialogOpen] = useState(false);

  const form = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      username: user.username || '',
      displayName: user.displayName || '',
      password: '',
      userType: user.userType || '',
      permissions: user.permissions || [],
    },
  });

  const watchedUserType = form.watch('userType');
  const lastUserTypeRef = useRef(user.userType);
  const isInitializingRef = useRef(true);

  const fetchUserTypes = async () => {
    try {
      const res = await fetch(getApiUrl('/user-types'));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setUserTypes(data);
    } catch (error) {
      console.error('Failed to fetch user types:', error);
    }
  };

  useEffect(() => {
    if (open) fetchUserTypes();
  }, [open]);

  useEffect(() => {
    if (open) {
      form.reset({
        username: user.username || '',
        displayName: user.displayName || '',
        password: '',
        userType: user.userType || '',
        permissions: user.permissions || [],
      });
    }
  }, [open, user, form]);

  // Only sync permissions when user actively changes the type (not on initial load)
  useEffect(() => {
    if (open && watchedUserType && userTypes.length > 0) {
      if (isInitializingRef.current) {
        lastUserTypeRef.current = watchedUserType;
        isInitializingRef.current = false;
        return;
      }
      if (watchedUserType !== lastUserTypeRef.current) {
        const selectedType = userTypes.find(t => t.name === watchedUserType);
        if (selectedType) form.setValue('permissions', selectedType.permissions || []);
        lastUserTypeRef.current = watchedUserType;
      }
    } else if (!open) {
      isInitializingRef.current = true;
    }
  }, [watchedUserType, form, open, userTypes]);

  const onSubmit = async (values: EditUserFormValues) => {
    try {
      const response = await fetch(getApiUrl(`/users/${user.uid}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: values.username,
          displayName: values.displayName,
          password: values.password,
          userType: values.userType,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update user');

      await logActivity({
        action: 'UPDATE',
        module: 'USERS',
        description: `Updated user: ${values.displayName} (${values.username}) — Type: ${values.userType}`,
        referenceId: user.uid,
      });
      toast({ title: 'User Updated', description: `Details for ${values.username} have been updated successfully.` });
      onUserUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Update User', description: error.message || 'An unexpected error occurred.' });
    }
  };

  return {
    form, onSubmit,
    userTypes, fetchUserTypes,
    isUserTypeDialogOpen, setIsUserTypeDialogOpen,
  };
}
