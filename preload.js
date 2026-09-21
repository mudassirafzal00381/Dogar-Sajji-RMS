// contextIsolation is enabled and nodeIntegration is disabled (see main.js).
// This is the only bridge between renderer JS and Node/Electron APIs —
// the renderer never touches Node or the database directly, only these
// whitelisted, promise-returning calls over ipcRenderer.invoke.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getMenuItems: () => ipcRenderer.invoke('db:getMenuItems'),
  saveMenuItems: (items) => ipcRenderer.invoke('db:saveMenuItems', items),
  getMenuCategories: () => ipcRenderer.invoke('db:getMenuCategories'),
  saveMenuCategories: (cats) => ipcRenderer.invoke('db:saveMenuCategories', cats),

  getDeals: () => ipcRenderer.invoke('db:getDeals'),
  saveDeals: (deals) => ipcRenderer.invoke('db:saveDeals', deals),

  getTables: () => ipcRenderer.invoke('db:getTables'),
  saveTables: (tables) => ipcRenderer.invoke('db:saveTables', tables),

  getOrders: () => ipcRenderer.invoke('db:getOrders'),
  saveOrders: (orders) => ipcRenderer.invoke('db:saveOrders', orders),

  getUnpaidBills: () => ipcRenderer.invoke('db:getUnpaidBills'),
  saveUnpaidBills: (bills) => ipcRenderer.invoke('db:saveUnpaidBills', bills),

  getInventory: () => ipcRenderer.invoke('db:getInventory'),
  saveInventory: (inv) => ipcRenderer.invoke('db:saveInventory', inv),

  getEmployees: () => ipcRenderer.invoke('db:getEmployees'),
  saveEmployees: (emps) => ipcRenderer.invoke('db:saveEmployees', emps),

  getPettyCash: () => ipcRenderer.invoke('db:getPettyCash'),
  savePettyCash: (pc) => ipcRenderer.invoke('db:savePettyCash', pc),

  getSalesLedger: () => ipcRenderer.invoke('db:getSalesLedger'),
  saveSalesLedger: (sl) => ipcRenderer.invoke('db:saveSalesLedger', sl),

  getExpenseLedger: () => ipcRenderer.invoke('db:getExpenseLedger'),
  saveExpenseLedger: (el) => ipcRenderer.invoke('db:saveExpenseLedger', el),

  getSettings: () => ipcRenderer.invoke('db:getSettings'),
  saveSettings: (s) => ipcRenderer.invoke('db:saveSettings', s),

  getAppUsers: () => ipcRenderer.invoke('db:getAppUsers'),
  saveAppUsers: (users) => ipcRenderer.invoke('db:saveAppUsers', users),

  getCancelledOrders: () => ipcRenderer.invoke('db:getCancelledOrders'),
  saveCancelledOrders: (c) => ipcRenderer.invoke('db:saveCancelledOrders', c),

  isDbEmpty: () => ipcRenderer.invoke('db:isEmpty'),
  clearAllData: () => ipcRenderer.invoke('db:clearAllData'),
  migrateFromLocalStorage: (legacy) => ipcRenderer.invoke('db:migrateFromLocalStorage', legacy),

  backupDatabase: () => ipcRenderer.invoke('db:backup'),
  saveCSV: (options) => ipcRenderer.invoke('file:saveCSV', options),
  getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
  printReceipt: (html, options) => ipcRenderer.invoke('print:receipt', html, options),
});

