const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  connectPrinter: (portSetting) => ipcRenderer.invoke('printer:connect', portSetting),
  printData: (buffer) => ipcRenderer.invoke('printer:print', buffer),
  disconnectPrinter: () => ipcRenderer.invoke('printer:disconnect'),
  
  // Epson SDK
  listEpsonPrinters: () => ipcRenderer.invoke('epson-printer:list'),
  connectEpsonPrinter: (portSetting) => ipcRenderer.invoke('epson-printer:connect', portSetting),
  printEpsonData: (buffer) => ipcRenderer.invoke('epson-printer:print', buffer),
  disconnectEpsonPrinter: () => ipcRenderer.invoke('epson-printer:disconnect'),
  cutEpsonPaper: () => ipcRenderer.invoke('epson-printer:cut'),
  openEpsonDrawer: () => ipcRenderer.invoke('epson-printer:open-drawer'),

  // Launch-at-startup (Windows desktop only). getStartup reports
  // { supported, enabled } so the UI can hide the toggle where it means
  // nothing (web builds, dev runs, non-Windows).
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: (enabled) => ipcRenderer.invoke('startup:set', enabled),

  // Clears the Chromium HTTP/asset cache (does NOT touch the database)
  clearCache: () => ipcRenderer.invoke('cache:clear'),

  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  openCustomerDisplay: () => ipcRenderer.invoke('window:open-customer-display'),
  closeCustomerDisplay: () => ipcRenderer.invoke('window:close-customer-display'),

  // Flag to tell the UI if it should show custom window controls
  isFrameless: () => {
    // Look for the argument we passed in BrowserWindow additionalArguments
    const isAdminArg = process.argv.find(arg => arg.startsWith('--is-admin='));
    return isAdminArg ? isAdminArg.split('=')[1] === 'false' : true; // Default to true for safety
  }
});

