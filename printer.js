// ══════════════════════════════════════════════════════════════════════════════
// ⚡ Dogar Sajji — ESC/POS NETWORK THERMAL PRINTING (Kitchen & Billing printers)
// ══════════════════════════════════════════════════════════════════════════════
// Builds raw ESC/POS byte buffers and writes them directly over a TCP socket
// to the configured WiFi POS-80 printers (standard raw-text port 9100). This
// module runs inside server.js so every device — including mobile browsers,
// which can never open a raw TCP socket themselves — prints through the same
// HTTP call; the Electron desktop app uses the identical path, since it also
// just calls its own locally-running server.js over localhost. There is no
// dependency on Windows printer drivers, browser print dialogs, or any
// per-device setup: the printer's IP/port lives once in the shared settings
// (see database.js) and every request is routed here by logical target
// ('kitchen' | 'billing'), never by a client-supplied address.

const net = require('net');

const ESC = '\x1B', GS = '\x1D';
const CMD = {
  INIT: ESC + '@',
  CENTER: ESC + 'a\x01',
  LEFT: ESC + 'a\x00',
  BOLD_ON: ESC + 'E\x01',
  BOLD_OFF: ESC + 'E\x00',
  DOUBLE_ON: GS + '!\x11',
  DOUBLE_OFF: GS + '!\x00',
  CUT: GS + 'V\x00',
};

const LINE_WIDTH = 42; // POS-80 @ standard font is ~42-48 chars/line

function hr(ch) { return (ch || '-').repeat(LINE_WIDTH) + '\n'; }

// Thermal printers use a fixed single-byte codepage — Urdu/Arabic glyphs in
// item names (e.g. menu items formatted as "Full Sajji (فل سجی)") would
// otherwise print as garbled bytes. Strip that block so tickets/receipts
// print the plain-English portion cleanly instead of mangled text.
function asciiSafe(text) {
  if (!text) return '';
  return String(text)
    .replace(/[؀-ۿ]+/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function padRow(left, right, width) {
  width = width || LINE_WIDTH;
  left = String(left); right = String(right);
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

function wrapText(text, width) {
  width = width || LINE_WIDTH;
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { if (cur) lines.push(cur.trim()); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function money(n) {
  return 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

// ── Kitchen ticket: new order / edited order / cancellation ──
// `reason` controls only the status banner and item-line prefix — the item
// list passed in is always printed in full (the caller is responsible for
// passing the order's complete current items for 'new'/'updated', or just
// the affected items for a cancellation).
function buildKitchenTicket(payload) {
  const {
    orderId, orderType, table, time, waiter, note,
    customerPhone, customerAddress, items, isAddOn, reason
  } = payload || {};
  const type = orderType || 'Dine-in';
  const list = Array.isArray(items) ? items : [];
  const headerTitle = type === 'Dine-in' ? `TABLE ${table}` : String(type).toUpperCase();
  const now = new Date().toLocaleString('en-PK');

  let statusBox;
  if (reason === 'updated') statusBox = 'ORDER UPDATED\nFULL REVISED ORDER BELOW';
  else if (reason === 'cancelled-full') statusBox = 'COMPLETE ORDER CANCELLED';
  else if (reason === 'cancelled-partial') statusBox = 'ITEM(S) CANCELLED';
  else statusBox = isAddOn ? 'ADD-ON ORDER' : 'NEW ORDER';

  let out = '';
  out += CMD.INIT;
  out += CMD.CENTER + CMD.BOLD_ON;
  out += 'Dogar Sajji & Restaurant\n';
  out += CMD.BOLD_OFF;
  out += '*** KITCHEN TICKET ***\n';
  out += now + '\n';
  out += hr('=');
  out += CMD.DOUBLE_ON + CMD.BOLD_ON + headerTitle + '\n' + CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  out += `Order: ${orderId || ''}  |  ${time || ''}\n`;
  if (type === 'Delivery' && (customerPhone || customerAddress)) {
    out += asciiSafe(`${customerPhone || ''} ${customerAddress ? '- ' + customerAddress : ''}`) + '\n';
  }
  out += CMD.BOLD_ON;
  statusBox.split('\n').forEach(l => out += l + '\n');
  out += CMD.BOLD_OFF;
  out += hr('-');
  out += CMD.LEFT;

  const prefix = (reason === 'cancelled-full' || reason === 'cancelled-partial') ? 'CANCEL ' : '';
  list.forEach(i => {
    const label = `${prefix}${i.qty}x  ${asciiSafe(i.name)}`;
    wrapText(label).forEach(l => out += l + '\n');
    if (i.desc) out += `   > ${asciiSafe(i.desc)}\n`;
  });
  if (list.length === 0) out += '(no items)\n';

  if (note) {
    out += hr('-');
    out += CMD.BOLD_ON + 'SPECIAL INSTRUCTIONS:\n' + CMD.BOLD_OFF;
    wrapText(asciiSafe(note)).forEach(l => out += l + '\n');
  }

  out += hr('=');
  out += CMD.CENTER + `Staff: ${asciiSafe(waiter || 'Counter')}\n`;
  out += '-- End of Ticket --\n\n\n\n';
  out += CMD.CUT;

  return Buffer.from(out, 'latin1');
}

// ── Customer bill: final settled receipt, or an unpaid customer invoice ──
function buildCustomerBill(payload) {
  const {
    isInvoice, headerLabel, receiptNo, orderTypeLabel, servedBy, paymentMethod,
    customerPhone, customerAddress, items, sub, discAmt,
    perHeadRate, perHeadPersons, perHead, deliveryCharge,
    total, cashReceived, balance, mergedRef
  } = payload || {};
  const list = Array.isArray(items) ? items : [];
  const now = new Date().toLocaleString('en-PK');

  let out = '';
  out += CMD.INIT;
  out += CMD.CENTER + CMD.BOLD_ON + CMD.DOUBLE_ON;
  out += 'Dogar Sajji & Restaurant\n';
  out += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  out += 'Taste the Best Sajji in Town\n';
  out += 'Ph: 0300-1863406\n';
  out += 'Govt Graduate College, Multan Road, Muzaffargarh\n';
  out += hr('=');
  out += CMD.LEFT;
  out += padRow(isInvoice ? 'Invoice #' : 'Receipt #', receiptNo || '') + '\n';
  out += padRow('Date', now) + '\n';
  out += padRow('Order Type', `${orderTypeLabel || ''}${headerLabel ? ' - ' + headerLabel : ''}`) + '\n';
  out += padRow('Served By', asciiSafe(servedBy || '')) + '\n';
  if (mergedRef) out += asciiSafe(mergedRef) + '\n';
  out += hr('-');
  if (customerPhone || customerAddress) {
    out += CMD.CENTER;
    out += asciiSafe(`${customerPhone || ''} ${customerAddress ? '- ' + customerAddress : ''}`) + '\n';
    out += CMD.LEFT;
  }
  out += CMD.CENTER + CMD.BOLD_ON;
  out += (isInvoice ? '*** UNPAID INVOICE (ESTIMATE) ***' : `PAYMENT: ${paymentMethod || 'Cash'}`) + '\n';
  out += CMD.BOLD_OFF + CMD.LEFT;
  out += hr('-');

  list.forEach(i => {
    const lineTotal = money((i.qty || 0) * (i.price || 0));
    const lines = wrapText(`${i.qty}x ${asciiSafe(i.name)}`);
    lines.forEach((l, idx) => {
      out += (idx === lines.length - 1 ? padRow(l, lineTotal) : l) + '\n';
    });
    if (i.desc) out += `   > ${asciiSafe(i.desc)}\n`;
  });

  out += hr('-');
  out += padRow('Subtotal', money(sub)) + '\n';
  if (discAmt) out += padRow('Discount', '-' + money(discAmt)) + '\n';
  if (perHead) out += padRow(`Per Head (${perHeadRate} x ${perHeadPersons})`, money(perHead)) + '\n';
  if (deliveryCharge) out += padRow('Delivery Charges', '+' + money(deliveryCharge)) + '\n';
  out += hr('=');
  out += CMD.BOLD_ON + CMD.DOUBLE_ON;
  out += padRow('TOTAL', money(total)) + '\n';
  out += CMD.DOUBLE_OFF + CMD.BOLD_OFF;

  if (!isInvoice && cashReceived) {
    out += hr('-');
    out += padRow('Cash Received', money(cashReceived)) + '\n';
    out += CMD.BOLD_ON;
    out += (Number(balance) >= 0
      ? padRow('Change Return', money(balance))
      : padRow('BALANCE DUE', money(Math.abs(balance)))) + '\n';
    out += CMD.BOLD_OFF;
  }

  out += hr('=');
  out += CMD.CENTER;
  out += 'Thank you for dining with us!\n';
  out += 'Please visit again\n';
  out += 'Developer Contact: 03255775600\n\n\n\n';
  out += CMD.CUT;

  return Buffer.from(out, 'latin1');
}

function buildTestPage(label) {
  const now = new Date().toLocaleString('en-PK');
  let out = '';
  out += CMD.INIT + CMD.CENTER + CMD.BOLD_ON + CMD.DOUBLE_ON;
  out += 'Dogar Sajji & Restaurant\n';
  out += CMD.DOUBLE_OFF;
  out += `*** ${label} ***\n`;
  out += CMD.BOLD_OFF;
  out += now + '\n';
  out += hr('-');
  out += 'If you can read this clearly,\n';
  out += 'this printer is configured correctly.\n';
  out += hr('=');
  out += '\n\n\n';
  out += CMD.CUT;
  return Buffer.from(out, 'latin1');
}

// ── Raw TCP sender — the actual network hop to the physical printer ──
function sendRaw(ip, port, buffer, timeoutMs) {
  timeoutMs = timeoutMs || 6000;
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error('Printer IP address is not configured'));
    const p = Number(port) || 9100;
    const socket = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch (e) {}
      if (err) reject(err); else resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(new Error(`Printer at ${ip}:${p} timed out — check it is powered on and connected to WiFi`)));
    socket.once('error', (e) => finish(new Error(`Could not reach printer at ${ip}:${p} (${(e && e.code) || (e && e.message) || 'connection error'})`)));
    socket.connect(p, ip, () => {
      socket.write(buffer, (err) => {
        if (err) return finish(err);
        setTimeout(() => finish(), 250); // let the printer flush before closing
      });
    });
  });
}

// ── Per-target print queue ──
// Multiple devices can submit jobs for the same printer at once; a cheap
// thermal printer chokes on overlapping TCP connections, so jobs for a given
// target (kitchen/billing) are always sent one at a time, in arrival order.
const queues = { kitchen: [], billing: [] };
const processing = { kitchen: false, billing: false };

function enqueue(target, task) {
  return new Promise((resolve, reject) => {
    queues[target].push({ task, resolve, reject });
    pump(target);
  });
}

async function pump(target) {
  if (processing[target]) return;
  processing[target] = true;
  while (queues[target].length) {
    const job = queues[target].shift();
    try {
      const result = await job.task();
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    }
  }
  processing[target] = false;
}

// ── Duplicate-job suppression ──
// A client generates one jobId per logical print action and reuses that same
// id if it has to retry the request (e.g. after a network blip) — this makes
// sure that retry can't result in the ticket/receipt printing twice. A fresh,
// user-initiated print (a new jobId) is never blocked by this, including a
// deliberate reprint after a previous attempt failed.
const seenJobs = new Map(); // jobId -> { status: 'done'|'failed', at }
const JOB_TTL_MS = 3 * 60 * 1000;

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, rec] of seenJobs) {
    if (rec.at < cutoff) seenJobs.delete(id);
  }
}

async function printToTarget(target, ip, port, buffer, jobId) {
  cleanupJobs();
  if (jobId) {
    const rec = seenJobs.get(jobId);
    if (rec && rec.status === 'done') return { duplicate: true };
  }
  try {
    await enqueue(target, () => sendRaw(ip, port, buffer));
    if (jobId) seenJobs.set(jobId, { status: 'done', at: Date.now() });
    return { duplicate: false };
  } catch (err) {
    if (jobId) seenJobs.set(jobId, { status: 'failed', at: Date.now() });
    throw err;
  }
}

module.exports = {
  buildKitchenTicket,
  buildCustomerBill,
  buildTestPage,
  sendRaw,
  printToTarget,
};
