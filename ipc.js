// Registers ipcMain.handle for every db.js function, under a 'db:' channel prefix,
// plus system handlers for printing, backups, and file exports.
const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const { exec } = require('child_process');

function getWindowsSpoolerPrinters() {
  return new Promise((resolve) => {
    const psCmd = 'Get-CimInstance Win32_Printer | Select-Object Name, Default, PortName, DriverName | ConvertTo-Json -Compress';
    exec(`powershell -NoProfile -Command "${psCmd}"`, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) return resolve([]);
      try {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        resolve(list.map(p => ({
          name: p.Name,
          displayName: p.PortName ? `${p.Name} (${p.PortName})` : p.Name,
          isDefault: !!p.Default,
          port: p.PortName || '',
          driver: p.DriverName || ''
        })));
      } catch (e) {
        resolve([]);
      }
    });
  });
}

function registerIpcHandlers(db) {
  const handlers = {
    'db:getMenuItems': () => db.getMenuItems(),
    'db:saveMenuItems': (e, items) => db.saveMenuItems(items),
    'db:getMenuCategories': () => db.getMenuCategories(),
    'db:saveMenuCategories': (e, cats) => db.saveMenuCategories(cats),

    'db:getDeals': () => db.getDeals(),
    'db:saveDeals': (e, deals) => db.saveDeals(deals),

    'db:getTables': () => db.getTables(),
    'db:saveTables': (e, tables) => db.saveTables(tables),

    'db:getOrders': () => db.getOrders(),
    'db:saveOrders': (e, orders) => db.saveOrders(orders),

    'db:getUnpaidBills': () => db.getUnpaidBills(),
    'db:saveUnpaidBills': (e, bills) => db.saveUnpaidBills(bills),

    'db:getInventory': () => db.getInventory(),
    'db:saveInventory': (e, inv) => db.saveInventory(inv),

    'db:getEmployees': () => db.getEmployees(),
    'db:saveEmployees': (e, emps) => db.saveEmployees(emps),

    'db:getPettyCash': () => db.getPettyCash(),
    'db:savePettyCash': (e, pc) => db.savePettyCash(pc),

    'db:getSalesLedger': () => db.getSalesLedger(),
    'db:saveSalesLedger': (e, sl) => db.saveSalesLedger(sl),

    'db:getExpenseLedger': () => db.getExpenseLedger(),
    'db:saveExpenseLedger': (e, el) => db.saveExpenseLedger(el),

    'db:getSettings': () => db.getSettings(),
    'db:saveSettings': (e, s) => db.saveSettings(s),

    'db:getAppUsers': () => db.getAppUsers(),
    'db:saveAppUsers': (e, u) => db.saveAppUsers(u),

    'db:isEmpty': () => db.isDbEmpty(),
    'db:clearAllData': () => db.clearAllData(),
    'db:migrateFromLocalStorage': (e, legacy) => db.migrateFromLocalStorage(legacy),

    // ── DATABASE BACKUP ──
    'db:backup': async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: "Backup Dogar Sajji Database",
          defaultPath: `dogar-sajji-backup-${today}.db`,
          filters: [
            { name: 'SQLite Database', extensions: ['db', 'sqlite'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        if (canceled || !filePath) return { success: false, canceled: true };
        await db.backupDatabase(filePath);
        return { success: true, filePath };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    // ── CSV REPORT EXPORT ──
    'file:saveCSV': async (e, { defaultName, content }) => {
      try {
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Save CSV Report',
          defaultPath: defaultName || 'dogar-sajji-report.csv',
          filters: [
            { name: 'CSV Document (*.csv)', extensions: ['csv'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        if (canceled || !filePath) return { success: false, canceled: true };
        fs.writeFileSync(filePath, content, 'utf8');
        return { success: true, filePath };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },

    // ── THERMAL / SILENT RECEIPT PRINTING ──
    'print:getPrinters': async (event) => {
      let electronPrinters = [];
      try {
        let win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
        if (!win) {
          const wins = BrowserWindow.getAllWindows();
          if (wins.length > 0) win = wins[0];
        }
        if (win && win.webContents && typeof win.webContents.getPrintersAsync === 'function') {
          electronPrinters = await win.webContents.getPrintersAsync();
        }
      } catch (err) {
        console.warn('Electron getPrintersAsync error:', err);
      }

      let windowsPrinters = [];
      if (process.platform === 'win32') {
        try {
          windowsPrinters = await getWindowsSpoolerPrinters();
        } catch (e) {
          console.warn('Windows spooler scan error:', e);
        }
      }

      const printerMap = new Map();

      // 1. Add Electron detected printers
      for (const p of electronPrinters) {
        printerMap.set(p.name, {
          name: p.name,
          displayName: p.displayName || p.name,
          description: p.description || '',
          status: p.status,
          isDefault: !!p.isDefault,
          isThermal: /pos|thermal|receipt|80|58|xprinter|epson|citizen|star|bixolon/i.test(p.name)
        });
      }

      // 2. Merge Windows Spooler printers (ensures no printers/ports are missed)
      for (const wp of windowsPrinters) {
        if (!printerMap.has(wp.name)) {
          printerMap.set(wp.name, {
            name: wp.name,
            displayName: wp.displayName || wp.name,
            description: wp.port ? `Port: ${wp.port}` : '',
            status: 0,
            isDefault: !!wp.isDefault,
            port: wp.port || '',
            isThermal: /pos|thermal|receipt|80|58|xprinter|epson|citizen|star|bixolon/i.test(wp.name)
          });
        } else {
          const existing = printerMap.get(wp.name);
          if (wp.isDefault) existing.isDefault = true;
          if (wp.port) {
            existing.port = wp.port;
            if (!existing.description) existing.description = `Port: ${wp.port}`;
          }
        }
      }

      const merged = Array.from(printerMap.values());
      merged.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        if (a.isThermal && !b.isThermal) return -1;
        if (!a.isThermal && b.isThermal) return 1;
        return a.name.localeCompare(b.name);
      });

      return merged;
    },

    'print:receipt': async (event, html, options = {}) => {
      return new Promise((resolve) => {
        try {
          const printWin = new BrowserWindow({
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
          });

          const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
          printWin.loadURL(dataUrl);

          printWin.webContents.on('did-finish-load', () => {
            const printOptions = {
              silent: options.silent !== false,
              printBackground: true,
              landscape: false,
              margins: { marginType: 'none' }
            };
            if (options.deviceName) {
              printOptions.deviceName = options.deviceName;
            }

            printWin.webContents.print(printOptions, (success, failureReason) => {
              // If printing to a specific device failed, retry once with default printer before giving up
              if (!success && options.deviceName) {
                console.warn(`Print to "${options.deviceName}" failed (${failureReason}). Retrying with default printer...`);
                delete printOptions.deviceName;
                printWin.webContents.print(printOptions, (retrySuccess, retryReason) => {
                  try { printWin.destroy(); } catch (e) {}
                  if (retrySuccess) {
                    resolve({ success: true, usedFallback: true });
                  } else {
                    resolve({ success: false, error: retryReason });
                  }
                });
              } else {
                try { printWin.destroy(); } catch (e) {}
                if (success) {
                  resolve({ success: true });
                } else {
                  resolve({ success: false, error: failureReason });
                }
              }
            });
          });

          printWin.webContents.on('did-fail-load', (e, code, desc) => {
            try { printWin.destroy(); } catch (err) {}
            resolve({ success: false, error: desc });
          });
        } catch (err) {
          resolve({ success: false, error: err.message });
        }
      });
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }
}

module.exports = { registerIpcHandlers };

