/**
 * Who the authorization dialog verified. `userId` is set only when a real user
 * logged in; the fixed credentials configured in Security Settings belong to
 * no account. `name` is null when nothing identifies the approver — fixed
 * credentials with no username configured accept any username, so the one
 * typed proves nothing.
 */
export interface AuthApprover {
  userId: string | null;
  name: string | null;
}

export interface AdminAuthDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSuccess: (approver: AuthApprover) => void;
  requiredCredentials?: { username?: string | null; password?: string | null } | null;
  title?: string;
  description?: string;
  /** When true, the dialog won't restore focus to the trigger on close. */
  preventCloseAutoFocus?: boolean;
}
