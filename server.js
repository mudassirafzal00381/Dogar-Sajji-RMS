// ══════════════════════════════════════════════════════════════════════════════
// ⚡ Dogar Sajji — CENTRAL BACKEND HTTP API SERVER
// ══════════════════════════════════════════════════════════════════════════════
// Provides a unified REST API and static file web server running on port 4850.
// Allows all browser profiles (Chrome/Edge Profile A & B), mobile devices,
// and Electron windows on the same network/PC to connect to one central database.

const http = require('http');
const fs = require('fs');
const path = require('path');
const database = require('./database');
const printer = require('./printer');

const DEFAULT_PORT = 4850;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 50 * 1024 * 1024) { // 50MB safety limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(reqPath, res) {
  let relativePath = reqPath === '/' ? '/renderer/index.html' : reqPath;
  if (relativePath.startsWith('/renderer')) {
    relativePath = relativePath.replace('/renderer', '');
  }
  let filePath = path.join(__dirname, 'renderer', relativePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'renderer', 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function handleApiRequest(req, res, urlPath) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── Health Check ──
    if (urlPath === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', app: "Dogar Sajji & Restaurant", empty: database.isDbEmpty() }));
      return;
    }

    // ── Get All Data ──
    if (urlPath === '/api/data' && req.method === 'GET') {
      const data = database.getAllData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data }));
      return;
    }

    // ── Save All Data (Batch) ──
    if (urlPath === '/api/save-all' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      database.saveAllData(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'All data saved to central database' }));
      return;
    }

    // ── One-time Legacy Migration ──
    if (urlPath === '/api/migrate-legacy' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const isDone = database.migrateFromLocalStorage(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: isDone }));
      return;
    }

    // ── ESC/POS NETWORK THERMAL PRINTING (Kitchen & Billing printers) ──
    // These are the only two routes that talk to the physical WiFi POS-80
    // printers. The printer's IP/port is read here, from this server's own
    // shared settings — never from the request body — so which printer a
    // job goes to can never depend on a client's (possibly stale) config.
    // This is what lets a mobile browser "print" at all: it can't open a
    // raw TCP socket itself, so it POSTs structured order/bill data here and
    // this process (already running on the counter PC, on the same WiFi as
    // both printers) does the actual ESC/POS send on its behalf.
    if (urlPath === '/api/print/kitchen' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const cfg = (database.getSettings().printerConfig || {}).kitchen || {};
      if (!cfg.ip) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Kitchen printer is not configured yet — open Printer Settings and set its IP address.' }));
      }
      try {
        const buffer = printer.buildKitchenTicket(body);
        const result = await printer.printToTarget('kitchen', cfg.ip, cfg.port, buffer, body.jobId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, duplicate: result.duplicate }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    if (urlPath === '/api/print/billing' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const cfg = (database.getSettings().printerConfig || {}).billing || {};
      if (!cfg.ip) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Billing printer is not configured yet — open Printer Settings and set its IP address.' }));
      }
      try {
        // docType distinguishes a customer bill/invoice from the day-end
        // closing report — both are admin-counter documents, so both go to
        // the billing printer, just with different ESC/POS templates.
        const buffer = body.docType === 'closing-report'
          ? printer.buildClosingReport(body)
          : printer.buildCustomerBill(body);
        const result = await printer.printToTarget('billing', cfg.ip, cfg.port, buffer, body.jobId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, duplicate: result.duplicate }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    if (urlPath === '/api/print/test' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const target = body.target === 'billing' ? 'billing' : 'kitchen';
      const cfg = (database.getSettings().printerConfig || {})[target] || {};
      if (!cfg.ip) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: `${target === 'kitchen' ? 'Kitchen' : 'Billing'} printer is not configured yet — enter its IP address first.` }));
      }
      try {
        const buffer = printer.buildTestPage(target === 'kitchen' ? 'KITCHEN PRINTER TEST' : 'BILLING PRINTER TEST');
        const result = await printer.printToTarget(target, cfg.ip, cfg.port, buffer, body.jobId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, duplicate: result.duplicate }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // ── Specific Entity Handlers ──
    if (urlPath === '/api/orders' || urlPath.startsWith('/api/orders/')) {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getOrders()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveOrders(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
      if (req.method === 'PUT') {
        const orderId = urlPath.replace('/api/orders/', '');
        const body = await parseJsonBody(req);
        let allOrders = database.getOrders();
        if (body.status === 'completed' || body.status === 'rejected') {
          allOrders = allOrders.filter(o => String(o.id) !== String(orderId));
        } else {
          const target = allOrders.find(o => String(o.id) !== String(orderId));
          if (target) Object.assign(target, body);
        }
        database.saveOrders(allOrders);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
      if (req.method === 'DELETE') {
        const orderId = urlPath.replace('/api/orders/', '');
        let allOrders = database.getOrders();
        allOrders = allOrders.filter(o => String(o.id) !== String(orderId));
        database.saveOrders(allOrders);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath.startsWith('/api/unpaid-bills/') && req.method === 'DELETE') {
      const billKey = urlPath.replace('/api/unpaid-bills/', '');
      const unpaid = database.getUnpaidBills();
      delete unpaid[billKey];
      database.saveUnpaidBills(unpaid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    if (urlPath === '/api/tables') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getTables()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveTables(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/menu-items') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getMenuItems()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveMenuItems(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/menu-categories') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getMenuCategories()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveMenuCategories(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/deals') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getDeals()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveDeals(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/inventory') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getInventory()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveInventory(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/employees') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getEmployees()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveEmployees(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/petty-cash') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getPettyCash()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.savePettyCash(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/sales-ledger') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getSalesLedger()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveSalesLedger(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/expense-ledger') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getExpenseLedger()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveExpenseLedger(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/settings') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getSettings()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveSettings(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/app-users') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getAppUsers()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveAppUsers(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    if (urlPath === '/api/cancelled-orders') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(database.getCancelledOrders()));
      }
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        database.saveCancelledOrders(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  } catch (err) {
    console.error('API Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function startServer(port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    database.initDatabase();

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const urlPath = parsedUrl.pathname;

      if (urlPath.startsWith('/api/')) {
        handleApiRequest(req, res, urlPath);
      } else {
        serveStaticFile(urlPath, res);
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`ℹ️ Backend HTTP Server already running on port ${port}. Using existing server instance.`);
        resolve(false);
      } else {
        console.error('Server error:', err);
        resolve(false);
      }
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Central Backend HTTP API Server listening on http://localhost:${port}`);
      resolve(true);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, DEFAULT_PORT };
