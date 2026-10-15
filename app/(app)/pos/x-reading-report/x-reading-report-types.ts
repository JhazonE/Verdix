export interface XReadingDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId?: string;
  autoShow?: boolean;
  terminalName?: string;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  /** POS Setup → Security Settings: when false, no credentials are asked for. */
  requireAuth?: boolean;
  /** Credentials configured in POS Setup; null means fall back to admin login. */
  authCredentials?: { username?: string | null; password?: string | null } | null;
}
