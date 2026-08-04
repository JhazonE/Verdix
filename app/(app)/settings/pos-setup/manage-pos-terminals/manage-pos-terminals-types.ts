import { z } from 'zod';

export const terminalSchema = z.object({
  ipAddress: z.string().optional(),
  terminalDescription: z.string().optional(),
  serialNumber: z.string().optional(),
  min: z.string().optional(),
  permitNo: z.string().optional(),
  accreditationNo: z.string().optional(),
  permitDateIssued: z.string().optional(),
  printOfficialReceipt: z.string().optional(),
  orNextReference: z.string().optional(),
  inventoryLocation: z.string().optional(),
});

export type TerminalFormValues = z.infer<typeof terminalSchema>;

export const TERMINAL_DEFAULTS: TerminalFormValues = {
  ipAddress: '',
  terminalDescription: '',
  serialNumber: '',
  min: '',
  permitNo: '',
  accreditationNo: '',
  permitDateIssued: '',
  printOfficialReceipt: 'No',
  orNextReference: '',
  inventoryLocation: 'Store',
};
