const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database');
const { registerIpcHandlers } = require('./ipc');
const { startServer } = require('./server');

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

function createSplashWindow() {
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

  splashWin.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Dogar Sajji RMS",
    icon: path.join(__dirname, 'logo.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    // Brief delay to allow splash loading animation to finish cleanly
    setTimeout(() => {
      win.show();
      win.focus();
      if (splashWin && !splashWin.isDestroyed()) {
        splashWin.close();
        splashWin = null;
      }
    }, 600);
  });
}

app.whenReady().then(() => {
  app.setName("Dogar Sajji");
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.dogarsajji.rms');
  }

  migrateUserDataFolderIfNeeded();
  database.initDatabase();
  startServer().catch(err => console.warn('Backend server start error:', err));
  registerIpcHandlers(database);

  createSplashWindow();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

