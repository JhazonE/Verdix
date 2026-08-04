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
  lastActive: string | null;
  createdAt: string;
}
