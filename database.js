// ══════════════════════════════════════════════════════
// SQLite database layer (main process only).
// One table per old localStorage key. Nested/array fields
// that don't map to scalar columns (order items, employee
// salary history, etc.) are stored as JSON text columns —
// this keeps the migration 1:1 with the old localStorage
// shape instead of redesigning the data model.
// ══════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

let db;
let currentDbPath = '';

function getSharedDbDirectory() {
  let dbDir = '';
  try {
    if (app && typeof app.getPath === 'function') {
      try {
        dbDir = path.join(app.getPath('commonUserData'), 'DogarSajji');
      } catch (e) {}
      if (!dbDir) {
        const commonDir = process.env.ALLUSERSPROFILE || process.env.ProgramData;
        if (commonDir) {
          dbDir = path.join(commonDir, 'DogarSajji');
        }
      }
      if (!dbDir) {
        dbDir = app.getPath('userData');
      }
    }
  } catch (err) {
    dbDir = path.join(__dirname, 'data');
  }
  if (!dbDir) {
    dbDir = path.join(__dirname, 'data');
  }
  return dbDir;
}

function initDatabase() {
  const dbDir = getSharedDbDirectory();
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const sharedPath = path.join(dbDir, 'dogar-sajji.db');

  if (!fs.existsSync(sharedPath)) {
    try {
      const userDir = (app && typeof app.getPath === 'function') ? app.getPath('userData') : '';
      if (userDir && userDir !== dbDir) {
        const legacy1 = path.join(userDir, 'desi-bites.db');
        const legacy2 = path.join(userDir, 'dogar-sajji.db');
        if (fs.existsSync(legacy2)) {
          fs.copyFileSync(legacy2, sharedPath);
        } else if (fs.existsSync(legacy1)) {
          fs.copyFileSync(legacy1, sharedPath);
        }
      }
      const sameDirLegacy = path.join(dbDir, 'desi-bites.db');
      if (!fs.existsSync(sharedPath) && fs.existsSync(sameDirLegacy)) {
        fs.copyFileSync(sameDirLegacy, sharedPath);
      }
    } catch (e) {
      console.warn('Migration copy warning:', e);
    }
  }

  currentDbPath = sharedPath;
  db = new Database(sharedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createSchema();
  migrateColumns();
  return db;
}

// Adds/renames columns introduced after a table already existed on disk —
// CREATE TABLE IF NOT EXISTS alone won't retrofit an older table.
function migrateColumns() {
  const menuItemCols = db.prepare('PRAGMA table_info(menu_items)').all().map(c => c.name);
  if (!menuItemCols.includes('variants')) {
    db.exec(`ALTER TABLE menu_items ADD COLUMN variants TEXT DEFAULT '[]'`);
  }

  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!orderCols.includes('orderType')) {
    db.exec(`ALTER TABLE orders ADD COLUMN orderType TEXT DEFAULT 'Dine-in'`);
  }
  if (!orderCols.includes('customerPhone')) {
    db.exec(`ALTER TABLE orders ADD COLUMN customerPhone TEXT DEFAULT ''`);
  }
  if (!orderCols.includes('customerAddress')) {
    db.exec(`ALTER TABLE orders ADD COLUMN customerAddress TEXT DEFAULT ''`);
  }

  // unpaid_bills used to be keyed by a numeric table id only; Takeaway/Delivery
  // orders have no table, so the key now doubles as either a table id or an order id.
  // A plain RENAME COLUMN isn't enough here: the old column was INTEGER PRIMARY
  // KEY, which SQLite treats as a rowid alias and strictly enforces as integer —
  // it'll reject a text order id even after the rename. Rebuild the table so the
  // key column is genuinely TEXT, carrying over any existing rows.
  const unpaidCols = db.prepare('PRAGMA table_info(unpaid_bills)').all();
  const oldKeyCol = unpaidCols.find(c => c.name === 'table_id');
  const billKeyCol = unpaidCols.find(c => c.name === 'bill_key');
  // Needs rebuilding if it's still got the old column name, OR if an earlier,
  // buggy migration already renamed it without fixing the underlying type
  // (a plain RENAME COLUMN leaves an INTEGER PRIMARY KEY as an integer rowid
  // alias no matter what you call it).
  const sourceCol = oldKeyCol ? 'table_id' : (billKeyCol && billKeyCol.type === 'INTEGER' ? 'bill_key' : null);
  if (sourceCol) {
    db.exec(`
      CREATE TABLE unpaid_bills_new (
        bill_key     TEXT PRIMARY KEY,
        order_id     TEXT,
        items        TEXT NOT NULL DEFAULT '[]',
        time         TEXT,
        addOnTickets INTEGER DEFAULT 0
      );
      INSERT INTO unpaid_bills_new (bill_key, order_id, items, time, addOnTickets)
        SELECT CAST(${sourceCol} AS TEXT), order_id, items, time, addOnTickets FROM unpaid_bills;
      DROP TABLE unpaid_bills;
      ALTER TABLE unpaid_bills_new RENAME TO unpaid_bills;
    `);
  }

  const salesCols = db.prepare('PRAGMA table_info(sales_ledger)').all().map(c => c.name);
  if (!salesCols.includes('orderType')) {
    db.exec(`ALTER TABLE sales_ledger ADD COLUMN orderType TEXT DEFAULT 'Dine-in'`);
  }
  if (!salesCols.includes('customerPhone')) {
    db.exec(`ALTER TABLE sales_ledger ADD COLUMN customerPhone TEXT DEFAULT ''`);
  }
  if (!salesCols.includes('customerAddress')) {
    db.exec(`ALTER TABLE sales_ledger ADD COLUMN customerAddress TEXT DEFAULT ''`);
  }
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_categories (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      cat       TEXT,
      price     REAL DEFAULT 0,
      discount  REAL DEFAULT 0,
      desc      TEXT DEFAULT '',
      img       TEXT DEFAULT '',
      available INTEGER DEFAULT 1,
      variants  TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS deals (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      category  TEXT NOT NULL,
      items     TEXT NOT NULL DEFAULT '[]',
      price     REAL DEFAULT 0,
      available INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tables (
      id           INTEGER PRIMARY KEY,
      status       TEXT DEFAULT 'available',
      persons      INTEGER DEFAULT 0,
      seats        INTEGER DEFAULT 4,
      reservedFor  TEXT DEFAULT '',
      reservedTime TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS orders (
      id              TEXT PRIMARY KEY,
      table_id        INTEGER,
      items           TEXT NOT NULL DEFAULT '[]',
      status          TEXT DEFAULT 'pending',
      note            TEXT DEFAULT '',
      time            TEXT,
      waiter          TEXT,
      isAddOn         INTEGER DEFAULT 0,
      total           REAL DEFAULT 0,
      orderType       TEXT DEFAULT 'Dine-in',
      customerPhone   TEXT DEFAULT '',
      customerAddress TEXT DEFAULT ''
    );

    -- bill_key is a table id (Dine-in) or an order id (Takeaway/Delivery, which
    -- have no table) — each pending, not-yet-paid bill is tracked by whichever
    -- of those it belongs to.
    CREATE TABLE IF NOT EXISTS unpaid_bills (
      bill_key     TEXT PRIMARY KEY,
      order_id     TEXT,
      items        TEXT NOT NULL DEFAULT '[]',
      time         TEXT,
      addOnTickets INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id    INTEGER PRIMARY KEY,
      item  TEXT NOT NULL,
      unit  TEXT,
      stock REAL DEFAULT 0,
      min   REAL DEFAULT 0,
      price REAL DEFAULT 0,
      last  TEXT
    );

    CREATE TABLE IF NOT EXISTS employees (
      id             INTEGER PRIMARY KEY,
      name           TEXT NOT NULL,
      cnic           TEXT DEFAULT '',
      phone          TEXT DEFAULT '',
      designation    TEXT DEFAULT '',
      salary         REAL DEFAULT 0,
      status         TEXT DEFAULT 'Present',
      address        TEXT DEFAULT '',
      salaryPayments TEXT NOT NULL DEFAULT '[]',
      advances       TEXT NOT NULL DEFAULT '[]',
      attendanceLog  TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS petty_cash (
      id       INTEGER PRIMARY KEY,
      name     TEXT,
      category TEXT,
      amount   REAL DEFAULT 0,
      date     TEXT,
      notes    TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sales_ledger (
      id              TEXT PRIMARY KEY,
      date            TEXT,
      table_id        INTEGER,
      items           TEXT NOT NULL DEFAULT '[]',
      total           REAL DEFAULT 0,
      payment         TEXT,
      waiter          TEXT,
      discount        REAL DEFAULT 0,
      perHead         REAL DEFAULT 0,
      orderType       TEXT DEFAULT 'Dine-in',
      customerPhone   TEXT DEFAULT '',
      customerAddress TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS expense_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT,
      category    TEXT,
      amount      REAL DEFAULT 0,
      description TEXT DEFAULT '',
      meta        TEXT DEFAULT '{}'
    );

    -- Roti Counter module was removed (not relevant to Dogar Sajji). Table is
    -- kept, unused, only so any historical records already in it aren't lost.
    CREATE TABLE IF NOT EXISTS roti_orders (
      id      INTEGER PRIMARY KEY,
      qty     INTEGER DEFAULT 0,
      total   REAL DEFAULT 0,
      time    TEXT,
      printed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS app_users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role     TEXT NOT NULL DEFAULT 'Admin',
      name     TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cancelled_orders (
      id         TEXT PRIMARY KEY,
      date       TEXT,
      time       TEXT,
      order_id   TEXT,
      table_id   INTEGER,
      orderType  TEXT DEFAULT 'Dine-in',
      items      TEXT NOT NULL DEFAULT '[]',
      cost       REAL DEFAULT 0,
      waiter     TEXT DEFAULT '',
      cancelType TEXT DEFAULT 'Partial'
    );
  `);
}

// ── generic replace-all helper: mirrors localStorage.setItem semantics
// (each save fully replaces the table contents in one transaction) ──
function replaceAll(table, rows, insertSql, toParams) {
  const tx = db.transaction((rows) => {
    db.prepare(`DELETE FROM ${table}`).run();
    const insert = db.prepare(insertSql);
    for (const row of rows) insert.run(toParams(row));
  });
  tx(rows || []);
}

// ── menu items ──
// `variants` holds size-based pricing (e.g. Small/Medium/Large/Family or
// Half/Full) as a JSON array of {label, price}. Items without size options
// leave it empty and just use the flat `price` column.
function getMenuItems() {
  return db.prepare('SELECT * FROM menu_items ORDER BY id').all()
    .map(r => ({ ...r, available: !!r.available, variants: JSON.parse(r.variants || '[]') }));
}
function saveMenuItems(items) {
  replaceAll(
    'menu_items', items,
    `INSERT INTO menu_items (id,name,cat,price,discount,desc,img,available,variants)
     VALUES (@id,@name,@cat,@price,@discount,@desc,@img,@available,@variants)`,
    i => ({
      id: i.id, name: i.name, cat: i.cat || '', price: i.price || 0,
      discount: i.discount || 0, desc: i.desc || '', img: i.img || '',
      available: i.available ? 1 : 0, variants: JSON.stringify(i.variants || []),
    })
  );
}

// ── deals (bundles) — kept separate from menu_items since they bundle
// multiple products rather than being a single sellable item ──
function getDeals() {
  return db.prepare('SELECT * FROM deals ORDER BY id').all()
    .map(r => ({ ...r, available: !!r.available, items: JSON.parse(r.items || '[]') }));
}
function saveDeals(deals) {
  replaceAll(
    'deals', deals,
    `INSERT INTO deals (id,name,category,items,price,available)
     VALUES (@id,@name,@category,@items,@price,@available)`,
    d => ({
      id: d.id, name: d.name, category: d.category || '',
      items: JSON.stringify(d.items || []), price: d.price || 0,
      available: d.available === false ? 0 : 1,
    })
  );
}

// ── menu categories ──
function getMenuCategories() {
  return db.prepare('SELECT name FROM menu_categories ORDER BY id').all().map(r => r.name);
}
function saveMenuCategories(categories) {
  const tx = db.transaction((cats) => {
    db.prepare('DELETE FROM menu_categories').run();
    const insert = db.prepare('INSERT INTO menu_categories (name) VALUES (?)');
    for (const name of cats) insert.run(name);
  });
  tx(categories || []);
}

// ── tables ──
function getTables() {
  return db.prepare('SELECT * FROM tables ORDER BY id').all();
}
function saveTables(tables) {
  replaceAll(
    'tables', tables,
    `INSERT INTO tables (id,status,persons,seats,reservedFor,reservedTime)
     VALUES (@id,@status,@persons,@seats,@reservedFor,@reservedTime)`,
    t => ({
      id: t.id, status: t.status || 'available', persons: t.persons || 0,
      seats: t.seats || 4, reservedFor: t.reservedFor || '', reservedTime: t.reservedTime || '',
    })
  );
}

// ── orders ──
// orderType is 'Dine-in' | 'Takeaway' | 'Delivery'. table is null for
// Takeaway/Delivery since those don't occupy a physical table.
function getOrders() {
  return db.prepare('SELECT * FROM orders ORDER BY rowid').all().map(r => ({
    id: r.id, table: r.table_id, items: JSON.parse(r.items || '[]'), status: r.status,
    note: r.note, time: r.time, waiter: r.waiter, isAddOn: !!r.isAddOn, total: r.total,
    orderType: r.orderType || 'Dine-in', customerPhone: r.customerPhone || '',
    customerAddress: r.customerAddress || '',
  }));
}
function saveOrders(orders) {
  replaceAll(
    'orders', orders,
    `INSERT INTO orders (id,table_id,items,status,note,time,waiter,isAddOn,total,orderType,customerPhone,customerAddress)
     VALUES (@id,@table_id,@items,@status,@note,@time,@waiter,@isAddOn,@total,@orderType,@customerPhone,@customerAddress)`,
    o => ({
      id: String(o.id), table_id: o.table ?? null, items: JSON.stringify(o.items || []),
      status: o.status || 'pending', note: o.note || '', time: o.time || '',
      waiter: o.waiter || '', isAddOn: o.isAddOn ? 1 : 0, total: o.total || 0,
      orderType: o.orderType || 'Dine-in', customerPhone: o.customerPhone || '',
      customerAddress: o.customerAddress || '',
    })
  );
}

// ── unpaid bills (object keyed by bill_key: a table id for Dine-in, or an
// order id for Takeaway/Delivery) ──
function getUnpaidBills() {
  const rows = db.prepare('SELECT * FROM unpaid_bills').all();
  const result = {};
  for (const r of rows) {
    result[r.bill_key] = {
      orderId: r.order_id, items: JSON.parse(r.items || '[]'), time: r.time,
      addOnTickets: r.addOnTickets,
    };
  }
  return result;
}
function saveUnpaidBills(unpaidBills) {
  const entries = Object.entries(unpaidBills || {});
  const tx = db.transaction((entries) => {
    db.prepare('DELETE FROM unpaid_bills').run();
    const insert = db.prepare(
      `INSERT INTO unpaid_bills (bill_key,order_id,items,time,addOnTickets)
       VALUES (@bill_key,@order_id,@items,@time,@addOnTickets)`
    );
    for (const [billKey, bill] of entries) {
      insert.run({
        bill_key: String(billKey), order_id: bill.orderId ?? null,
        items: JSON.stringify(bill.items || []), time: bill.time || '',
        addOnTickets: bill.addOnTickets || 0,
      });
    }
  });
  tx(entries);
}

// ── inventory ──
function getInventory() {
  return db.prepare('SELECT * FROM inventory ORDER BY id').all();
}
function saveInventory(inventory) {
  replaceAll(
    'inventory', inventory,
    `INSERT INTO inventory (id,item,unit,stock,min,price,last)
     VALUES (@id,@item,@unit,@stock,@min,@price,@last)`,
    i => ({
      id: i.id,
      item: i.item || i.name || '',
      unit: i.unit || '',
      stock: Number(i.stock ?? i.qty ?? 0),
      min: Number(i.min ?? i.minQty ?? 0),
      price: Number(i.price ?? i.cost ?? 0),
      last: i.last || ''
    })
  );
}

// ── employees ──
function getEmployees() {
  return db.prepare('SELECT * FROM employees ORDER BY id').all().map(e => ({
    ...e,
    salaryPayments: JSON.parse(e.salaryPayments || '[]'),
    advances: JSON.parse(e.advances || '[]'),
    attendanceLog: JSON.parse(e.attendanceLog || '[]'),
  }));
}
function saveEmployees(employees) {
  replaceAll(
    'employees', employees,
    `INSERT INTO employees (id,name,cnic,phone,designation,salary,status,address,salaryPayments,advances,attendanceLog)
     VALUES (@id,@name,@cnic,@phone,@designation,@salary,@status,@address,@salaryPayments,@advances,@attendanceLog)`,
    e => ({
      id: e.id, name: e.name || '', cnic: e.cnic || '', phone: e.phone || '',
      designation: e.designation || '', salary: e.salary || 0, status: e.status || 'Present',
      address: e.address || '', salaryPayments: JSON.stringify(e.salaryPayments || []),
      advances: JSON.stringify(e.advances || []), attendanceLog: JSON.stringify(e.attendanceLog || []),
    })
  );
}

// ── petty cash ──
function getPettyCash() {
  return db.prepare('SELECT * FROM petty_cash ORDER BY id').all();
}
function savePettyCash(pettyCash) {
  replaceAll(
    'petty_cash', pettyCash,
    `INSERT INTO petty_cash (id,name,category,amount,date,notes)
     VALUES (@id,@name,@category,@amount,@date,@notes)`,
    p => ({
      id: p.id, name: p.name || '', category: p.category || 'Misc',
      amount: p.amount || 0, date: p.date || '', notes: p.notes || '',
    })
  );
}

// ── sales ledger ──
function getSalesLedger() {
  return db.prepare('SELECT * FROM sales_ledger ORDER BY rowid').all().map(r => ({
    id: r.id, date: r.date, table: r.table_id, items: JSON.parse(r.items || '[]'),
    total: r.total, payment: r.payment, waiter: r.waiter, discount: r.discount, perHead: r.perHead,
    orderType: r.orderType || 'Dine-in', customerPhone: r.customerPhone || '',
    customerAddress: r.customerAddress || '',
  }));
}
function saveSalesLedger(salesLedger) {
  replaceAll(
    'sales_ledger', salesLedger,
    `INSERT INTO sales_ledger (id,date,table_id,items,total,payment,waiter,discount,perHead,orderType,customerPhone,customerAddress)
     VALUES (@id,@date,@table_id,@items,@total,@payment,@waiter,@discount,@perHead,@orderType,@customerPhone,@customerAddress)`,
    s => ({
      id: String(s.id), date: s.date || '', table_id: s.table ?? null, items: JSON.stringify(s.items || []),
      total: s.total || 0, payment: s.payment || '', waiter: s.waiter || '',
      discount: s.discount || 0, perHead: s.perHead || 0,
      orderType: s.orderType || 'Dine-in', customerPhone: s.customerPhone || '',
      customerAddress: s.customerAddress || '',
    })
  );
}

// ── expense ledger (shape not finalized upstream yet; kept flexible) ──
function getExpenseLedger() {
  return db.prepare('SELECT * FROM expense_ledger ORDER BY id').all().map(r => ({
    ...r, meta: JSON.parse(r.meta || '{}'),
  }));
}
function saveExpenseLedger(expenseLedger) {
  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM expense_ledger').run();
    const insert = db.prepare(
      `INSERT INTO expense_ledger (date,category,amount,description,meta) VALUES (@date,@category,@amount,@description,@meta)`
    );
    for (const e of rows) {
      const { date, category, amount, description, ...rest } = e;
      insert.run({
        date: date || '', category: category || '', amount: amount || 0,
        description: description || '', meta: JSON.stringify(rest),
      });
    }
  });
  tx(expenseLedger || []);
}

// ── settings (key/value) ──
function getSettings() {
  const result = {};
  const rows = db.prepare('SELECT key, value FROM settings').all();
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch (e) {
      result[row.key] = row.value;
    }
  }
  return result;
}
function saveSettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  const tx = db.transaction((settingsObj) => {
    const upsert = db.prepare(
      `INSERT INTO settings (key,value) VALUES (@key,@value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    for (const [key, val] of Object.entries(settingsObj)) {
      if (val !== undefined) {
        upsert.run({ key, value: JSON.stringify(val) });
      }
    }
  });
  tx(settings);
}

function getCancelledOrders() {
  return db.prepare('SELECT * FROM cancelled_orders ORDER BY rowid DESC').all().map(r => ({
    id: r.id, date: r.date, time: r.time, orderId: r.order_id, table: r.table_id,
    orderType: r.orderType || 'Dine-in', items: JSON.parse(r.items || '[]'),
    cost: r.cost || 0, waiter: r.waiter || '', cancelType: r.cancelType || 'Partial'
  }));
}
function saveCancelledOrders(cancelledOrders) {
  replaceAll(
    'cancelled_orders', cancelledOrders,
    `INSERT INTO cancelled_orders (id,date,time,order_id,table_id,orderType,items,cost,waiter,cancelType)
     VALUES (@id,@date,@time,@order_id,@table_id,@orderType,@items,@cost,@waiter,@cancelType)`,
    c => ({
      id: String(c.id), date: c.date || '', time: c.time || '', order_id: String(c.orderId || ''),
      table_id: c.table ?? null, orderType: c.orderType || 'Dine-in',
      items: JSON.stringify(c.items || []), cost: c.cost || 0,
      waiter: c.waiter || '', cancelType: c.cancelType || 'Partial'
    })
  );
}

function getAllData() {
  return {
    inventory: getInventory(),
    employees: getEmployees(),
    pettyCash: getPettyCash(),
    salesLedger: getSalesLedger(),
    expenseLedger: getExpenseLedger(),
    menuItems: getMenuItems(),
    menuCategories: getMenuCategories(),
    deals: getDeals(),
    tables: getTables(),
    orders: getOrders(),
    unpaidBills: getUnpaidBills(),
    settings: getSettings(),
    appUsers: getAppUsers(),
    cancelledOrders: getCancelledOrders(),
  };
}

function saveAllData(data) {
  if (!data || typeof data !== 'object') return;
  if (data.inventory) saveInventory(data.inventory);
  if (data.employees) saveEmployees(data.employees);
  if (data.pettyCash) savePettyCash(data.pettyCash);
  if (data.salesLedger) saveSalesLedger(data.salesLedger);
  if (data.expenseLedger) saveExpenseLedger(data.expenseLedger);
  if (data.menuItems) saveMenuItems(data.menuItems);
  if (data.menuCategories) saveMenuCategories(data.menuCategories);
  if (data.deals) saveDeals(data.deals);
  if (data.tables) saveTables(data.tables);
  if (data.orders) saveOrders(data.orders);
  if (data.unpaidBills) saveUnpaidBills(data.unpaidBills);
  if (data.settings) saveSettings(data.settings);
  if (data.appUsers) saveAppUsers(data.appUsers);
  if (data.cancelledOrders) saveCancelledOrders(data.cancelledOrders);
}


// ── empty-database check (used to guard the one-time localStorage migration) ──
function isDbEmpty() {
  const tables = [
    'menu_items', 'menu_categories', 'tables', 'orders', 'unpaid_bills',
    'inventory', 'employees', 'petty_cash', 'sales_ledger', 'expense_ledger',
    'roti_orders', 'settings', 'deals', 'cancelled_orders',
  ];
  for (const t of tables) {
    const { count } = db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get();
    if (count > 0) return false;
  }
  return true;
}

// ── one-time migration of legacy localStorage data into SQLite ──
function migrateFromLocalStorage(legacy) {
  const tx = db.transaction((legacy) => {
    if (legacy.inventory) saveInventory(legacy.inventory);
    if (legacy.employees) saveEmployees(legacy.employees);
    if (legacy.pettyCash) savePettyCash(legacy.pettyCash);
    if (legacy.salesLedger) saveSalesLedger(legacy.salesLedger);
    if (legacy.expenseLedger) saveExpenseLedger(legacy.expenseLedger);
    if (legacy.menuItems) saveMenuItems(legacy.menuItems);
    if (legacy.menuCategories) saveMenuCategories(legacy.menuCategories);
    if (legacy.tables) saveTables(legacy.tables);
    if (legacy.orders) saveOrders(legacy.orders);
    if (legacy.unpaidBills) saveUnpaidBills(legacy.unpaidBills);
    if (legacy.settings) saveSettings(legacy.settings);
    if (legacy.cancelledOrders) saveCancelledOrders(legacy.cancelledOrders);
  });
  tx(legacy);
  return true;
}

function backupDatabase(destPath) {
  if (!db) throw new Error('Database not initialized');
  try {
    return db.backup(destPath);
  } catch (err) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const dbPath = currentDbPath || path.join(app.getPath('userData'), 'desi-bites.db');
    fs.copyFileSync(dbPath, destPath);
    return Promise.resolve(destPath);
  }
}

function clearAllData() {
  if (!db) return;
  const tables = [
    'menu_items', 'menu_categories', 'tables', 'orders', 'unpaid_bills',
    'inventory', 'employees', 'petty_cash', 'sales_ledger', 'expense_ledger',
    'roti_orders', 'settings', 'deals', 'cancelled_orders',
  ];
  const tx = db.transaction(() => {
    for (const t of tables) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    try {
      db.prepare(`DELETE FROM sqlite_sequence`).run();
    } catch (e) {}
  });
  tx();
}

function getAppUsers() {
  const rows = db.prepare('SELECT * FROM app_users').all();
  const defaultUsers = [
    { username: 'admin', password: '1234', role: 'Admin', name: 'Master Admin / Manager' },
    { username: 'order1', password: '1234', role: 'Order Taker', name: 'Order Taker 1' },
    { username: 'order2', password: '1234', role: 'Order Taker', name: 'Order Taker 2' }
  ];

  if (rows.length === 0) {
    const stmt = db.prepare('INSERT INTO app_users (username, password, role, name) VALUES (?, ?, ?, ?)');
    for (const u of defaultUsers) {
      stmt.run(u.username, u.password, u.role, u.name);
    }
    return defaultUsers;
  }

  // Ensure default order takers exist if only admin was present in database
  let updated = false;
  const insertStmt = db.prepare('INSERT OR IGNORE INTO app_users (username, password, role, name) VALUES (?, ?, ?, ?)');
  for (const u of defaultUsers) {
    if (!rows.some(r => String(r.username).toLowerCase() === u.username.toLowerCase())) {
      insertStmt.run(u.username, u.password, u.role, u.name);
      updated = true;
    }
  }

  if (updated) {
    return db.prepare('SELECT * FROM app_users').all();
  }

  return rows;
}

function saveAppUsers(users) {
  replaceAll(
    'app_users', users,
    `INSERT INTO app_users (username, password, role, name) VALUES (@username, @password, @role, @name)`,
    u => ({ username: u.username, password: u.password, role: u.role || 'Admin', name: u.name || u.username })
  );
}

module.exports = {
  initDatabase,
  getSharedDbDirectory,
  backupDatabase,
  getMenuItems, saveMenuItems,
  getMenuCategories, saveMenuCategories,
  getDeals, saveDeals,
  getTables, saveTables,
  getOrders, saveOrders,
  getUnpaidBills, saveUnpaidBills,
  getInventory, saveInventory,
  getEmployees, saveEmployees,
  getPettyCash, savePettyCash,
  getSalesLedger, saveSalesLedger,
  getExpenseLedger, saveExpenseLedger,
  getSettings, saveSettings,
  getAppUsers, saveAppUsers,
  getCancelledOrders, saveCancelledOrders,
  getAllData, saveAllData,
  isDbEmpty,
  clearAllData,
  migrateFromLocalStorage,
};


