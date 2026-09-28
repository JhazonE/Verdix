import { z } from 'zod';

export type User = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
  disabled: boolean;
  creationTime: string;
  userType?: string;
  permissions: string[];
};

export const editUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  displayName: z.string().min(1, 'Display name is required'),
  password: z.string()
    .transform(v => v === '' ? undefined : v)
    .pipe(z.string().min(6, 'Password must be at least 6 characters long').optional()),
  userType: z.string().min(1, 'User type is required'),
  // Display-only: driven entirely by the selected user type (see
  // UserPermissionsGrid), not user-editable, so it must not block submit.
  permissions: z.array(z.string()),
});

export type EditUserFormValues = z.infer<typeof editUserSchema>;
