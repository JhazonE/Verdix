export interface VoidLineChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (scope: 'selected' | 'all') => void;
  selectedItemName?: string | null;
  itemCount: number;
}
