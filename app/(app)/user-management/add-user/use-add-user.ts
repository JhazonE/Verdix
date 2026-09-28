'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { getApiUrl } from '@/lib/api-config';
import { logActivity } from '@/lib/client-activity-logger';
import { addUserSchema, AddUserFormValues } from './add-user-types';

export function useAddUser({ onUserAdded }: { onUserAdded: () => void }) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isUserTypeDialogOpen, setIsUserTypeDialogOpen] = useState(false);
  const [userTypes, setUserTypes] = useState<any[]>([]);

  const form = useForm<AddUserFormValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: {
      fullName: '',
      username: '',
      password: '',
      userType: '',
      permissions: ['view_dashboard'],
    },
  });

  const watchedUserType = form.watch('userType');

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
    if (isOpen) fetchUserTypes();
  }, [isOpen]);

  useEffect(() => {
    if (!watchedUserType || userTypes.length === 0) return;
    const selectedType = userTypes.find(t => t.name === watchedUserType);
    if (selectedType) form.setValue('permissions', selectedType.permissions || []);
  }, [watchedUserType, userTypes, form]);

  const onSubmit = async (values: AddUserFormValues) => {
    try {
      const response = await fetch(getApiUrl('/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: values.fullName,
          username: values.username,
          email: values.username,
          password: values.password,
          userType: values.userType,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create user');

      await logActivity({
        action: 'CREATE',
        module: 'USERS',
        description: `Created user: ${values.fullName} (${values.username}) — Type: ${values.userType}`,
        referenceId: result.uid,
      });
      toast({ title: 'User Created', description: `User ${values.fullName} (${values.username}) has been created successfully.` });
      onUserAdded();
      setIsOpen(false);
      form.reset();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Create User', description: error.message || 'An unexpected error occurred.' });
    }
  };

  return {
    isOpen, setIsOpen,
    form, onSubmit,
    userTypes, fetchUserTypes,
    isUserTypeDialogOpen, setIsUserTypeDialogOpen,
  };
}
