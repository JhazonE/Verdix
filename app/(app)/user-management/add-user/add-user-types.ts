import { z } from 'zod';

export const addUserSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  userType: z.string().min(1, 'User type is required'),
  // Display-only: driven entirely by the selected user type (see
  // UserPermissionsGrid), not user-editable, so it must not block submit.
  permissions: z.array(z.string()),
});

export type AddUserFormValues = z.infer<typeof addUserSchema>;
