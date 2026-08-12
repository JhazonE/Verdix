export interface EndShiftReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenOverallReading: () => void;
  onOpenXReading: () => void;
  onOpenZReadingWarning: () => void;
}
