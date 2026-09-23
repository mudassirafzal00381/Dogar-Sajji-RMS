// Registers ipcMain.handle for every db.js function, under a 'db:' channel prefix,
// plus system handlers for backups and file exports. Thermal receipt printing
// is not handled here — see server.js / printer.js, which every device
// (including this Electron app itself, over its own localhost) reaches over
// HTTP so kitchen tickets and bills always route to the correct network
// ESC/POS printer regardless of which device generated them.
const { ipcMain, dialog } = require('electron');
const fs = require('fs');

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

    'db:getCancelledOrders': () => db.getCancelledOrders(),
    'db:saveCancelledOrders': (e, c) => db.saveCancelledOrders(c),

    'db:getDailyCloseouts': () => db.getDailyCloseouts(),
    'db:saveDailyCloseouts': (e, c) => db.saveDailyCloseouts(c),

    'db:isEmpty': () => db.isDbEmpty(),
    'db:clearAllData': () => db.clearAllData(),
    'db:migrateFromLocalStorage': (e, legacy) => db.migrateFromLocalStorage(legacy),

    // ── DATABASE BACKUP ──
    'db:backup': async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: "Backup Dogar Sajji & Restaurant Database",
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

  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, handler);
  }
}

module.exports = { registerIpcHandlers };

