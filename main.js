const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const database = require('./database');
const { registerIpcHandlers } = require('./ipc');
const { startServer } = require('./server');

// Detects this PC's own LAN IPv4 address and records it as the print
// agent's address (server.js — the process that actually talks to the
// printers — runs inside this same Electron process). This is what lets
// the address self-heal after a DHCP lease change instead of silently
// going stale until someone notices printing has broken and manually
// re-runs ipconfig: every time the desktop app starts, it re-detects and
// re-saves its current address to the local database. The renderer (which
// has the Supabase connection this process doesn't) then reconciles that
// against the shared cloud value shortly after boot — see
// syncPrintAgentUrlIfChanged() in renderer/index.html.
function detectAndSaveLanAddress() {
  try {
    const nets = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) candidates.push(net.address);
      }
    }
    // Prefer a private-network address (what every device on the
    // restaurant's WiFi would actually use to reach this PC).
    const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
    const chosen = candidates.find(isPrivate) || candidates[0];
    if (chosen) {
      const url = `http://${chosen}:4850`;
      database.saveSettings({ printAgentUrl: url });
      console.log(`🌐 Detected LAN address for print agent: ${url}`);
    }
  } catch (e) {
    console.warn('LAN address detection warning:', e);
  }
}

// One-time carry-over of the SQLite database from the old "Desi Bites RMS"
// userData folder into the new "Dogar Sajji" one — the rebrand changes
// app.getPath('userData')'s default location, and without this the app
// would silently start from an empty database instead of the real data.
function migrateUserDataFolderIfNeeded() {
  const oldDir = path.join(app.getPath('appData'), 'Desi Bites RMS');
  const newDir = app.getPath('userData');
  const oldDbPath = path.join(oldDir, 'desi-bites.db');
  const newDbPath = path.join(newDir, 'desi-bites.db');

  if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(oldDbPath, newDbPath);
    ['-wal', '-shm'].forEach((suffix) => {
      const oldAux = oldDbPath + suffix;
      if (fs.existsSync(oldAux)) fs.copyFileSync(oldAux, newDbPath + suffix);
    });
  }
}

let splashWin = null;
let mainWin = null;

function createSplashWindow() {
  try {
    splashWin = new BrowserWindow({
      width: 480,
      height: 320,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      center: true,
      icon: path.join(__dirname, 'logo.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    splashWin.loadFile(path.join(__dirname, 'renderer', 'splash.html')).catch(() => {});
  } catch(e) {
    console.warn('Splash window create warning:', e);
  }
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Restaurant Management System",
    icon: path.join(__dirname, 'logo.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch(err => {
    console.error('Failed to load renderer index.html:', err);
  });

  const forceShowWindow = () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (!mainWin.isVisible()) {
        mainWin.show();
        mainWin.focus();
      }
    }
    if (splashWin && !splashWin.isDestroyed()) {
      splashWin.close();
      splashWin = null;
    }
  };

  mainWin.once('ready-to-show', () => {
    setTimeout(forceShowWindow, 400);
  });

  // HARD FALLBACK: Ensure main window is shown after 1.2 seconds even if ready-to-show didn't fire
  setTimeout(forceShowWindow, 1200);
}

app.whenReady().then(() => {
  try {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.restaurant.rms');
    }
  } catch(e){}

  try { migrateUserDataFolderIfNeeded(); } catch(e){ console.warn('UserData migrate:', e); }
  try { database.initDatabase(); } catch(e){ console.warn('DB init warning:', e); }
  try { detectAndSaveLanAddress(); } catch(e){ console.warn('LAN address detect warning:', e); }
  try { startServer().catch(err => console.warn('Backend server start error:', err)); } catch(e){}
  try { registerIpcHandlers(database); } catch(e){ console.warn('IPC register warning:', e); }

  createSplashWindow();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
