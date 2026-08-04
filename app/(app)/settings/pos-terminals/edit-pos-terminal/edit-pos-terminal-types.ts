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

export interface PosTerminal {
  id: string;
  ipAddress: string | null;
  terminalDescription: string | null;
  serialNumber: string | null;
  min: string | null;
  permitNo: string | null;
  accreditationNo: string | null;
  permitDateIssued: string | null;
  printOfficialReceipt: string | null;
  orNextReference: string | null;
  inventoryLocation: string | null;
}

export const TEXT_FIELDS: { name: keyof TerminalFormValues; label: string }[] = [
  { name: 'ipAddress',           label: 'IP ADDRESS' },
  { name: 'terminalDescription', label: 'Terminal Description' },
  { name: 'serialNumber',        label: 'Serial Number' },
  { name: 'min',                 label: 'MIN' },
  { name: 'permitNo',            label: 'PERMIT NO.' },
  { name: 'accreditationNo',     label: 'ACCREDITATION NO.' },
  { name: 'orNextReference',     label: 'OR Next reference' },
];
