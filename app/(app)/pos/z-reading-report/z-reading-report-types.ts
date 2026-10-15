export interface ZReadingDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  terminalId?: string;
  terminalName?: string;
  printMode: 'browser' | 'escpos' | 'usb' | 'native';
  initialData?: any;
  autoShow?: boolean;
  /** POS Setup → Security Settings: when false, no credentials are asked for. */
  requireAuth?: boolean;
  /** Credentials configured in POS Setup; null means fall back to admin login. */
  authCredentials?: { username?: string | null; password?: string | null } | null;
}
