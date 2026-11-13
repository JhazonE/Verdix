'use client';

import { Clock } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Props = {
  remainingMs: number | null;
  onStay: () => void;
  onLogout: () => void;
};

function formatCountdown(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Last-minute warning before an idle back-office session is signed out. */
export function IdleLogoutWarning({ remainingMs, onStay, onLogout }: Props) {
  return (
    // Open state is owned by the idle timer alone. Any key or mouse movement
    // already counts as activity and closes this on the next tick, so wiring
    // onOpenChange to onStay would only make "Log out now" refresh the session
    // on its way out.
    <AlertDialog open={remainingMs !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            Are you still there?
          </AlertDialogTitle>
          <AlertDialogDescription>
            You have been inactive for a while. For security, you will be logged out in{' '}
            <span className="font-mono font-semibold text-foreground">
              {remainingMs !== null ? formatCountdown(remainingMs) : '0:00'}
            </span>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onLogout}>Log out now</AlertDialogCancel>
          <AlertDialogAction onClick={onStay}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
