'use client';

import { Badge } from '@/components/ui/badge';
import { ALL_PERMISSIONS } from './permissions';
import { UseFormReturn } from 'react-hook-form';

type Props = {
  form: UseFormReturn<any>;
};

export function UserPermissionsGrid({ form }: Props) {
  const watchedUserType = form.watch('userType');
  const permissions: string[] = form.watch('permissions') || [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Permissions are set per User Type now — edit them from{' '}
        <span className="font-medium">User Management → User Types</span>.
        {watchedUserType ? ` Showing what "${watchedUserType}" currently grants.` : ' Select a user type to see its permissions.'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4 rounded-xl bg-muted/20 border border-muted-foreground/10">
        {ALL_PERMISSIONS.filter(p => permissions.includes(p.id)).map(permission => (
          <Badge key={permission.id} variant="secondary" className="justify-start font-normal">
            {permission.label}
          </Badge>
        ))}
        {permissions.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2">No permissions for this type.</p>
        )}
      </div>
    </div>
  );
}
